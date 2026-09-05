import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import multipart from "@fastify/multipart";
import {
  CaseAcceptedSchema,
  CaseProjectionSchema,
  AgentReportSchema,
  ProblemDetailsSchema,
  ReviewIssuesSchema,
} from "@findoc/contracts";
import { CaseNotFoundError, IdempotencyConflictError, type CaseCommandService, type CaseQueryService, type CaseReviewQueryService, type IntakeDocument, type SourceArtifactIntake } from "@findoc/core";
import { DocumentSizeLimitError, EmptyDocumentError, UnsupportedDocumentMediaError } from "@findoc/storage";

class IntakeRequestError extends Error {}

export function buildApp(
  caseCommands: CaseCommandService,
  caseQueries: CaseQueryService & CaseReviewQueryService,
  sourceIntake?: SourceArtifactIntake,
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
      links: {
        agent_report: `${base}/agent-report`,
        application_data: `${base}/application-data`,
        documents: `${base}/documents`,
        issues: `${base}/issues`,
        final_review: `${base}/final-review`,
      },
    };
  });

  app.get("/api/v1/cases/:case_id/agent-report", {
    schema: { response: { 200: AgentReportSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const report = await caseQueries.getAgentReport(caseId);
    return {
      availability: report.availability,
      ...(report.summary ? { summary: report.summary } : {}),
      issue_links: [...report.issueLinks],
      checked_facts: report.checkedFacts.map((fact) => ({
        statement: fact.statement,
        status: fact.status,
        references: [...fact.references],
      })),
    };
  });

  app.get("/api/v1/cases/:case_id/issues", {
    schema: { response: { 200: ReviewIssuesSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const issues = await caseQueries.getIssues(caseId);
    return { issues: issues.map((issue) => ({
      issue_id: issue.issueId, origin: issue.origin, code: issue.code,
      description: issue.description, recommended_action: issue.recommendedAction,
      review_state: issue.reviewState, version: issue.version,
    })) };
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
      const documents: IntakeDocument[] = [];
      try {
        if (request.isMultipart()) {
          if (!sourceIntake) throw new Error("Multipart source intake is not configured");
          let applicationData: unknown;
          for await (const part of request.parts()) {
            if (part.type === "file") {
              documents.push({
                submittedFilename: part.filename,
                artifact: await sourceIntake.store(part.file),
              });
            } else if (part.fieldname === "application_data") {
              try {
                applicationData = JSON.parse(String(part.value));
              } catch {
                throw new IntakeRequestError("application_data must be valid JSON");
              }
            }
          }
          if (documents.length === 0) throw new IntakeRequestError("Multipart intake requires at least one document");
          applicantDisplayName = readApplicantDisplayName(applicationData);
        } else {
          const body = request.body as { applicant_display_name: string };
          applicantDisplayName = readApplicantDisplayName(body);
        }
        const accepted = await caseCommands.accept({ applicantDisplayName, idempotencyKey: key, documents });
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
