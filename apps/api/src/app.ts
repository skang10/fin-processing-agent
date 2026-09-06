import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import multipart from "@fastify/multipart";
import {
  CaseAcceptedSchema,
  CreateIssueCommandSchema,
  CreateIssueResultSchema,
  CaseQueueQuerySchema,
  CaseQueueSchema,
  CaseProjectionSchema,
  AgentReportSchema,
  AgentLogSchema,
  EvidenceListProjectionSchema, EvidenceProjectionSchema,
  FindingsProjectionSchema,
  ApplicationDataProjectionSchema,
  DocumentPageProjectionSchema,
  DownstreamHandoffSchema,
  DocumentsProjectionSchema,
  EditIssueCommandSchema,
  EditIssueResultSchema,
  FinalReviewCommandSchema,
  FinalReviewResultSchema,
  ProblemDetailsSchema,
  RequestedChangeCommandSchema,
  RequestedChangeResultSchema,
  ResolveIssueCommandSchema,
  ResolveIssueResultSchema,
  ReviewIssuesSchema,
} from "@findoc/contracts";
import { CaseNotFoundError, HandoffUnavailableError, IdempotencyConflictError, ReviewConflictError, type CaseCommandService, type CaseQueryService, type CaseReviewQueryService, type IntakeDocument, type ObjectStore, type ReviewCommandService, type SourceArtifactIntake, type AgentLogSessionView } from "@findoc/core";
import { DocumentSizeLimitError, EmptyDocumentError, readObjectBytes, UnsupportedDocumentMediaError } from "@findoc/storage";

class IntakeRequestError extends Error {}

export function buildApp(
  caseCommands: CaseCommandService,
  caseQueries: CaseQueryService & CaseReviewQueryService,
  sourceIntake?: SourceArtifactIntake,
  reviewCommands?: ReviewCommandService,
  artifactStore?: ObjectStore,
) {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();
  void app.register(multipart, { limits: { files: 10, fields: 10 } });

  app.addHook("onRequest", async (request, reply) => {
    const requestId = request.id;
    void reply.header("X-Request-Id", requestId);
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply.code(409).type("application/problem+json").send({
        type: "https://example.invalid/problems/idempotency_conflict",
        title: "The idempotency key was already used",
        status: 409,
        code: "idempotency_conflict",
        request_id: request.id,
        detail: "Use the original request or submit a new idempotency key.",
      });
    }
    if (error instanceof CaseNotFoundError) {
      return reply.code(404).type("application/problem+json").send({
        type: "https://example.invalid/problems/not_found",
        title: "Case not found",
        status: 404,
        code: "not_found",
        request_id: request.id,
      });
    }
    if (error instanceof HandoffUnavailableError) {
      return reply.code(409).type("application/problem+json").send({
        type: "https://example.invalid/problems/handoff_unavailable",
        title: "Downstream handoff is unavailable",
        status: 409,
        code: "handoff_unavailable",
        request_id: request.id,
        detail: error.message,
      });
    }
    if (error instanceof ReviewConflictError) {
      const status = error.code === "invalid_review_action" ? 400 : 409;
      return reply.code(status).type("application/problem+json").send({
        type: `https://example.invalid/problems/${error.code}`,
        title: error.code === "review_incomplete" ? "Review is incomplete" : error.code === "stale_review" ? "Review state changed" : "Invalid review action",
        status, code: error.code, request_id: request.id, detail: error.message,
      });
    }
    if (error instanceof UnsupportedDocumentMediaError || error instanceof EmptyDocumentError) {
      return reply.code(415).type("application/problem+json").send({
        type: "https://example.invalid/problems/unsupported_document",
        title: "Unsupported document",
        status: 415,
        code: "unsupported_document",
        request_id: request.id,
      });
    }
    if (error instanceof DocumentSizeLimitError) {
      return reply.code(413).type("application/problem+json").send({
        type: "https://example.invalid/problems/document_too_large",
        title: "Document is too large",
        status: 413,
        code: "document_too_large",
        request_id: request.id,
      });
    }
    if (error instanceof IntakeRequestError) {
      return reply.code(400).type("application/problem+json").send({
        type: "https://example.invalid/problems/invalid_intake",
        title: "Invalid case intake",
        status: 400,
        code: "invalid_intake",
        request_id: request.id,
        detail: error.message,
      });
    }
    if (typeof error === "object" && error !== null && "validation" in error) {
      return reply.code(400).type("application/problem+json").send({
        type: "https://example.invalid/problems/invalid_request",
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        request_id: request.id,
      });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).type("application/problem+json").send({
      type: "https://example.invalid/problems/internal_error",
      title: "The request could not be completed",
      status: 500,
      code: "internal_error",
      request_id: request.id,
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/cases", {
    schema: {
      querystring: CaseQueueQuerySchema,
      response: { 200: CaseQueueSchema },
    },
  }, async (request) => {
    const view = (request.query as { view?: "review" | "changes_requested" | "completed" }).view ?? "review";
    const records = await caseQueries.list(view);
    return { view, cases: records.map((record) => ({
      case_id: record.caseId, applicant_display_name: record.applicantDisplayName,
      summary: record.summary, issue_count: record.issueCount, workflow_status: record.workflowStatus,
      lifecycle: record.lifecycle, waiting_since: record.waitingSince, version: record.version,
    })) };
  });

  app.get("/api/v1/cases/:case_id", {
    schema: {
      params: {
        type: "object",
        required: ["case_id"],
        properties: { case_id: { type: "string", format: "uuid" } },
      },
      response: { 200: CaseProjectionSchema, 404: ProblemDetailsSchema },
    },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const record = await caseQueries.get(caseId);
    const base = `/api/v1/cases/${record.caseId}`;
    return {
      case_id: record.caseId,
      applicant_display_name: record.applicantDisplayName,
      lifecycle: record.lifecycle,
      progress: record.progress,
      result_availability: record.resultAvailability,
      version: record.version,
      ...(record.finalReviewAction ? { final_review_action: record.finalReviewAction } : {}),
      links: {
        agent_report: `${base}/agent-report`,
        application_data: `${base}/application-data`,
        documents: `${base}/documents`,
        findings: `${base}/findings`,
        issues: `${base}/issues`,
        final_review: `${base}/final-review`,
        downstream_handoff: `${base}/downstream-handoff`,
        agent_log: `${base}/agent-log`,
      },
    };
  });

  app.get("/api/v1/cases/:case_id/downstream-handoff", {
    schema: { response: { 200: DownstreamHandoffSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const handoff = await caseQueries.getDownstreamHandoff(caseId);
    return {
      case_id: handoff.caseId, status: handoff.status,
      result_revision: { id: handoff.resultRevision.id, revision: handoff.resultRevision.revision, sealed_at: handoff.resultRevision.sealedAt },
      final_review: { id: handoff.finalReview.id, action: handoff.finalReview.action, reviewer_id: handoff.finalReview.reviewerId,
        completed_at: handoff.finalReview.completedAt, resulting_case_version: handoff.finalReview.resultingCaseVersion },
      recommended_disposition: { value: handoff.recommendedDisposition.value, policy_id: handoff.recommendedDisposition.policyId,
        policy_version: handoff.recommendedDisposition.policyVersion },
      claims: handoff.claims.map((claim) => ({ claim_id: claim.claimId, field_schema_id: claim.fieldSchemaId, value_type: claim.valueType,
        normalized_value: claim.normalizedValue, normalization_version: claim.normalizationVersion, evidence_references: [...claim.evidenceReferences] })),
      findings: handoff.findings.map((finding) => ({ finding_id: finding.findingId, rule_id: finding.ruleId,
        rule_version: finding.ruleVersion, status: finding.status, reason_code: finding.reasonCode, references: [...finding.references] })),
    };
  });

  app.get("/api/v1/cases/:case_id/agent-report", {
    schema: { response: { 200: AgentReportSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const report = await caseQueries.getAgentReport(caseId);
    return {
      availability: report.availability,
      ...(report.failureReason ? { failure_reason: report.failureReason } : {}),
      ...(report.resultRevision ? { result_revision: report.resultRevision } : {}),
      ...(report.summary ? { summary: report.summary } : {}),
      issue_links: [...report.issueLinks],
      checked_facts: report.checkedFacts.map((fact) => ({
        rule_id: fact.ruleId,
        statement: fact.statement,
        source_type: fact.sourceType,
        status: fact.status,
        references: [...fact.references],
      })),
    };
  });

  app.get("/api/v1/cases/:case_id/agent-log", {
    schema: { response: { 200: AgentLogSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const log = await caseQueries.getAgentLog(caseId);
    return {
      availability: log.availability,
      ...(log.modelLabel ? { model_label: log.modelLabel } : {}),
      ...(log.estimatedCost ? { estimated_cost: log.estimatedCost } : {}),
      current_step: log.currentStep,
      ...(log.session ? { session: projectAgentSession(log.session) } : {}),
      events: log.events.map((event) => ({ timestamp: event.timestamp, activity: event.activity,
        ...(event.toolLabel ? { tool_label: event.toolLabel } : {}) })),
    };
  });

  app.get("/api/v1/cases/:case_id/evidence/:evidence_id", {
    schema: { response: { 200: EvidenceProjectionSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId, evidence_id: evidenceId } = request.params as { case_id: string; evidence_id: string };
    const evidence = await caseQueries.getEvidence(caseId, evidenceId);
    if (evidence.evidenceType === "structured_input") {
      return {
        evidence_id: evidence.evidenceId, evidence_type: evidence.evidenceType,
        json_pointer: evidence.jsonPointer, extraction_method: evidence.extractionMethod,
        processor_version: evidence.processorVersion,
      };
    }
    return {
      evidence_id: evidence.evidenceId, evidence_type: evidence.evidenceType,
      document_version_id: evidence.documentVersionId, page_number: evidence.pageNumber,
      extraction_method: evidence.extractionMethod, processor_version: evidence.processorVersion,
    };
  });

  app.get("/api/v1/cases/:case_id/evidence", {
    schema: { response: { 200: EvidenceListProjectionSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const evidence = await caseQueries.listEvidence(caseId);
    return { evidence: evidence.map((item) => item.evidenceType === "structured_input" ? {
      evidence_id: item.evidenceId, evidence_type: item.evidenceType, json_pointer: item.jsonPointer,
      extraction_method: item.extractionMethod, processor_version: item.processorVersion,
    } : {
      evidence_id: item.evidenceId, evidence_type: item.evidenceType, document_version_id: item.documentVersionId,
      page_number: item.pageNumber, extraction_method: item.extractionMethod, processor_version: item.processorVersion,
    }) };
  });

  app.get("/api/v1/cases/:case_id/findings", {
    schema: { response: { 200: FindingsProjectionSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const findings = await caseQueries.getFindings(caseId);
    return { findings: findings.map((finding) => ({
      finding_id: finding.findingId,
      rule_id: finding.ruleId,
      rule_version: finding.ruleVersion,
      status: finding.status,
      reason_code: finding.reasonCode,
      references: [...finding.references],
    })) };
  });

  app.get("/api/v1/cases/:case_id/application-data", {
    schema: { response: { 200: ApplicationDataProjectionSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const projection = await caseQueries.getApplicationData(caseId);
    return {
      groups: projection.groups.map((group) => ({
        group: group.group,
        fields: group.fields.map((field) => ({
          key: field.key, display_value: field.displayValue, json_pointer: field.jsonPointer,
        })),
      })),
      submission_history: {
        initial_submitted_at: projection.submissionHistory.initialSubmittedAt,
        latest_submitted_at: projection.submissionHistory.latestSubmittedAt,
        application_data_updated_at: projection.submissionHistory.applicationDataUpdatedAt,
      },
    };
  });

  app.get("/api/v1/cases/:case_id/documents", {
    schema: { response: { 200: DocumentsProjectionSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const documents = await caseQueries.getDocuments(caseId);
    return { documents: documents.map((document) => ({
      document_id: document.documentId, physical_document_id: document.physicalDocumentId,
      version: document.version, submitted_filename: document.submittedFilename,
      media_type: document.mediaType, page_count: document.pageCount,
      content_url: `/api/v1/cases/${caseId}/documents/${document.documentId}/content`,
    })) };
  });

  app.get("/api/v1/cases/:case_id/documents/:document_id/content", async (request, reply) => {
    if (!artifactStore) throw new Error("Artifact content access is not configured");
    const { case_id: caseId, document_id: documentId } = request.params as { case_id: string; document_id: string };
    const artifact = await caseQueries.getSourceDocumentArtifact(caseId, documentId);
    const content = await readObjectBytes(artifactStore, artifact.objectKey, Math.max(artifact.byteSize, 1));
    return reply.header("cache-control", "private, no-store").type(artifact.mediaType).send(content);
  });

  app.get("/api/v1/cases/:case_id/documents/:document_id/pages/:page_number", {
    schema: { response: { 200: DocumentPageProjectionSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId, document_id: documentId, page_number: rawPageNumber } = request.params as { case_id: string; document_id: string; page_number: string };
    const page = await caseQueries.getDocumentPage(caseId, documentId, Number(rawPageNumber));
    return {
      document_id: page.documentId, page_number: page.pageNumber, needs_ocr: page.needsOcr,
      ...(page.ocrReason ? { ocr_reason: page.ocrReason } : {}),
      has_table: page.hasTable, has_columns: page.hasColumns,
      native_character_count: page.nativeCharacterCount,
      native_text_available: page.nativeTextAvailable,
      render_available: page.renderAvailable,
      ...(page.renderAvailable ? { render_url: `/api/v1/cases/${caseId}/documents/${documentId}/pages/${page.pageNumber}/render` } : {}),
    };
  });

  app.get("/api/v1/cases/:case_id/documents/:document_id/pages/:page_number/render", async (request, reply) => {
    if (!artifactStore) throw new Error("Artifact content access is not configured");
    const { case_id: caseId, document_id: documentId, page_number: rawPageNumber } = request.params as { case_id: string; document_id: string; page_number: string };
    const artifact = await caseQueries.getPageRenderArtifact(caseId, documentId, Number(rawPageNumber));
    const content = await readObjectBytes(artifactStore, artifact.objectKey, Math.max(artifact.byteSize, 1));
    return reply.header("cache-control", "private, no-store").type(artifact.mediaType).send(content);
  });

  app.get("/api/v1/cases/:case_id/documents/:document_id/pages/:page_number/native-text", async (request, reply) => {
    if (!artifactStore) throw new Error("Artifact content access is not configured");
    const { case_id: caseId, document_id: documentId, page_number: rawPageNumber } = request.params as { case_id: string; document_id: string; page_number: string };
    const artifact = await caseQueries.getNativeTextArtifact(caseId, documentId, Number(rawPageNumber));
    const content = await readObjectBytes(artifactStore, artifact.objectKey, Math.max(artifact.byteSize, 1));
    return reply.type("text/markdown; charset=utf-8").send(content);
  });

  app.get("/api/v1/cases/:case_id/issues", {
    schema: { response: { 200: ReviewIssuesSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const issues = await caseQueries.getIssues(caseId);
    return { issues: issues.map((issue) => ({
      issue_id: issue.issueId, origin: issue.origin, code: issue.code,
      ...(issue.title ? { title: issue.title } : {}),
      description: issue.description, recommended_action: issue.recommendedAction,
      review_state: issue.reviewState, version: issue.version,
      supporting_references: [...issue.supportingReferences],
      ...(issue.noReferenceReason ? { no_reference_reason: issue.noReferenceReason } : {}),
      edit_revision: issue.editRevision,
      ...(issue.requestedChange ? { requested_change: {
        draft_revision_id: issue.requestedChange.draftRevisionId, revision: issue.requestedChange.revision,
        text: issue.requestedChange.text, included: issue.requestedChange.included,
      } } : {}),
    })) };
  });

  app.post("/api/v1/cases/:case_id/issues", {
    schema: { body: CreateIssueCommandSchema, response: { 200: CreateIssueResultSchema, 400: ProblemDetailsSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema } },
  }, async (request) => {
    if (!reviewCommands) throw new Error("Review commands are not configured");
    const { case_id: caseId } = request.params as { case_id: string };
    const body = request.body as {
      result_revision_id: string; command_id: string; expected_case_version: number;
      title: string; description: string; recommended_action: string; supporting_references: string[]; no_reference_reason?: string;
    };
    const result = await reviewCommands.createIssue({
      caseId, resultRevisionId: body.result_revision_id, commandId: body.command_id,
      expectedCaseVersion: body.expected_case_version, title: body.title, description: body.description,
      recommendedAction: body.recommended_action, supportingReferences: body.supporting_references,
      ...(body.no_reference_reason ? { noReferenceReason: body.no_reference_reason } : {}),
    });
    return { issue_id: result.issueId, version: result.issueVersion, case_version: result.caseVersion };
  });

  app.patch("/api/v1/cases/:case_id/issues/:issue_id", {
    schema: { body: EditIssueCommandSchema, response: { 200: EditIssueResultSchema, 400: ProblemDetailsSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema } },
  }, async (request) => {
    if (!reviewCommands) throw new Error("Review commands are not configured");
    const { case_id: caseId, issue_id: issueId } = request.params as { case_id: string; issue_id: string };
    const body = request.body as {
      result_revision_id: string; command_id: string; expected_issue_version: number;
      title: string; description: string; recommended_action: string; supporting_references: string[]; no_reference_reason?: string;
    };
    const result = await reviewCommands.editIssue({
      caseId, issueId, resultRevisionId: body.result_revision_id, commandId: body.command_id,
      expectedIssueVersion: body.expected_issue_version, title: body.title, description: body.description,
      recommendedAction: body.recommended_action, supportingReferences: body.supporting_references,
      ...(body.no_reference_reason ? { noReferenceReason: body.no_reference_reason } : {}),
    });
    return { issue_id: issueId, version: result.issueVersion };
  });

  for (const action of ["confirm", "ignore"] as const) {
    app.post(`/api/v1/cases/:case_id/issues/:issue_id/${action}`, {
      schema: { body: ResolveIssueCommandSchema, response: { 200: ResolveIssueResultSchema, 400: ProblemDetailsSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema } },
    }, async (request) => {
      if (!reviewCommands) throw new Error("Review commands are not configured");
      const { case_id: caseId, issue_id: issueId } = request.params as { case_id: string; issue_id: string };
      const body = request.body as { result_revision_id: string; command_id: string; expected_issue_version: number; reason?: string };
      const result = await reviewCommands.resolveIssue({
        caseId, issueId, resultRevisionId: body.result_revision_id, commandId: body.command_id,
        expectedIssueVersion: body.expected_issue_version,
        action: action === "confirm" ? "accept_signal" : "dismiss_signal",
        ...(body.reason ? { reason: body.reason } : {}),
      });
      return { issue_id: issueId, review_state: result.reviewState, version: result.issueVersion };
    });
  }

  app.put("/api/v1/cases/:case_id/issues/:issue_id/requested-change", {
    schema: { body: RequestedChangeCommandSchema, response: { 200: RequestedChangeResultSchema, 400: ProblemDetailsSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema } },
  }, async (request) => {
    if (!reviewCommands) throw new Error("Review commands are not configured");
    const { case_id: caseId, issue_id: issueId } = request.params as { case_id: string; issue_id: string };
    const body = request.body as { result_revision_id: string; command_id: string; text: string; included: boolean };
    const result = await reviewCommands.saveRequestedChange({
      caseId, issueId, resultRevisionId: body.result_revision_id, commandId: body.command_id,
      text: body.text, included: body.included,
    });
    return { draft_revision_id: result.draftRevisionId, revision: result.revision };
  });

  app.post("/api/v1/cases/:case_id/final-review", {
    schema: { body: FinalReviewCommandSchema, response: { 200: FinalReviewResultSchema, 400: ProblemDetailsSchema, 404: ProblemDetailsSchema, 409: ProblemDetailsSchema } },
  }, async (request) => {
    if (!reviewCommands) throw new Error("Review commands are not configured");
    const { case_id: caseId } = request.params as { case_id: string };
    const body = request.body as {
      result_revision_id: string; command_id: string; expected_case_version: number;
      action: "request_changes" | "escalate_review" | "clear_for_downstream";
      selected_draft_revision_ids: string[]; internal_note?: string;
    };
    const result = await reviewCommands.submitFinalReview({
      caseId, resultRevisionId: body.result_revision_id, commandId: body.command_id,
      expectedCaseVersion: body.expected_case_version, action: body.action,
      selectedDraftRevisionIds: body.selected_draft_revision_ids,
      ...(body.internal_note ? { internalNote: body.internal_note } : {}),
    });
    return { final_review_id: result.finalReviewId, action: result.action, case_version: result.caseVersion };
  });

  app.post(
    "/api/v1/cases",
    {
      schema: {
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", minLength: 1 } },
        },
        response: { 202: CaseAcceptedSchema, 400: ProblemDetailsSchema },
      },
    },
    async (request, reply) => {
      const key = request.headers["idempotency-key"] as string;
      let applicantDisplayName: string;
      let applicationData: Readonly<Record<string, unknown>>;
      const documents: IntakeDocument[] = [];
      try {
        if (request.isMultipart()) {
          if (!sourceIntake) throw new Error("Multipart source intake is not configured");
          let rawApplicationData: unknown;
          for await (const part of request.parts()) {
            if (part.type === "file") {
              documents.push({
                submittedFilename: part.filename,
                artifact: await sourceIntake.store(part.file),
              });
            } else if (part.fieldname === "application_data") {
              try {
                rawApplicationData = JSON.parse(String(part.value));
              } catch {
                throw new IntakeRequestError("application_data must be valid JSON");
              }
            }
          }
          if (documents.length === 0) throw new IntakeRequestError("Multipart intake requires at least one document");
          applicationData = readApplicationData(rawApplicationData);
          applicantDisplayName = readApplicantDisplayName(applicationData);
        } else {
          applicationData = readApplicationData(request.body);
          applicantDisplayName = readApplicantDisplayName(applicationData);
        }
        const accepted = await caseCommands.accept({ applicantDisplayName, applicationData, idempotencyKey: key, documents });
        if (accepted.replayed) await discardUploads(sourceIntake, documents, request.log);
        const requestId = request.id || randomUUID();
        return reply.code(202).send({
          case_id: accepted.caseId,
          run_id: accepted.runId,
          lifecycle: "processing",
          status_url: `/api/v1/cases/${accepted.caseId}`,
          request_id: requestId,
        });
      } catch (error) {
        await discardUploads(sourceIntake, documents, request.log);
        throw error;
      }
    },
  );

  return app;
}

async function discardUploads(
  sourceIntake: SourceArtifactIntake | undefined,
  documents: readonly IntakeDocument[],
  logger: { warn(data: object, message: string): void },
): Promise<void> {
  if (!sourceIntake || documents.length === 0) return;
  const results = await Promise.allSettled(documents.map((document) => sourceIntake.discard(document.artifact)));
  const failedCount = results.filter((result) => result.status === "rejected").length;
  if (failedCount > 0) logger.warn({ failed_count: failedCount }, "failed to discard unreferenced uploads");
}

function readApplicantDisplayName(value: unknown): string {
  if (typeof value !== "object" || value === null || !("applicant_display_name" in value)) {
    throw new IntakeRequestError("application_data must contain applicant_display_name");
  }
  const name = (value as { applicant_display_name?: unknown }).applicant_display_name;
  if (typeof name !== "string" || name.trim().length === 0) throw new IntakeRequestError("applicant_display_name is required");
  return name;
}

function readApplicationData(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IntakeRequestError("application_data must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function projectAgentSession(session: AgentLogSessionView) {
  return {
    harness_label: session.harnessLabel, mode: session.mode, status: session.status,
    ...(session.terminalReason ? { terminal_reason: session.terminalReason } : {}),
    attempts: session.attempts, iterations: session.iterations, tool_calls: session.toolCalls,
    usage_available: session.usageAvailable,
  };
}
