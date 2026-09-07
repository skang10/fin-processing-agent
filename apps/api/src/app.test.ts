import { describe, expect, it, vi } from "vitest";
import { HandoffUnavailableError, IdempotencyConflictError } from "@findoc/core";
import { buildApp } from "./app.js";

const boundary = "findoc-test-boundary";
function multipartPayload(agentModel?: string) {
  return Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="application_data"\r\n\r\n`,
    JSON.stringify({ applicant_display_name: "Anna Beispiel", demo_fixture_id: "anna-example-v1" }),
    ...(agentModel ? [`\r\n--${boundary}\r\nContent-Disposition: form-data; name="agent_model"\r\n\r\n${agentModel}`] : []),
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="documents"; filename="statement.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    "%PDF-1.7\nDEMO",
    `\r\n--${boundary}--\r\n`,
  ].join(""));
}

describe("case intake", () => {
  const caseQueries = {
    list: vi.fn(async () => [{
      caseId: "4c816f67-5f2f-4e21-8c17-7eb1e53838bd", caseCode: "FD-2026-0042", applicantDisplayName: "Anna Beispiel",
      summary: "Three items require review.", reviewMethod: "deterministic" as const,
      issueCount: 1, workflowStatus: "ready_for_review" as const,
      lifecycle: "ready_for_review" as const, waitingSince: "2026-09-01T10:00:00.000Z", version: 2,
    }]),
    get: vi.fn(async () => ({
      caseId: "4c816f67-5f2f-4e21-8c17-7eb1e53838bd",
      caseCode: "FD-2026-0042",
      applicantDisplayName: "Anna Beispiel",
      lifecycle: "processing" as const,
      progress: "submitted" as const,
      resultAvailability: "pending" as const,
      version: 1,
    })),
    getAgentReport: vi.fn(async () => ({
      availability: "ready" as const,
      resultRevision: { id: "4c816f67-5f2f-4e21-8c17-7eb1e5383995", revision: 1 },
      summary: "Three items require review.",
      issueLinks: ["issue_1"],
      checkedFacts: [{
        ruleId: "VAL_NAME_CONSISTENCY_001",
        statement: "The applicant name is consistent.", sourceType: "deterministic_check" as const,
        status: "passed" as const,
        references: ["/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence/4c816f67-5f2f-4e21-8c17-7eb1e5383999"],
      }],
    })),
    getAgentLog: vi.fn(async () => ({
      availability: "ready" as const, modelLabel: "fake-pi-harness-v1",
      estimatedCost: { amount: "0.0000", currency: "EUR" as const }, currentStep: "awaiting_human_review" as const,
      session: { harnessLabel: "pi-agent-led-case-review-harness (pi-coding-agent@0.85.1)", mode: "case_review" as const, status: "terminal" as const, terminalReason: "report_submitted" as const, attempts: 2, iterations: 3, toolCalls: 3, modelCalls: 4, usageAvailable: true, inputTokens: 1200, outputTokens: 300, durationMs: 5000 },
      events: [
        { timestamp: "2026-09-01T10:03:00.000Z", activity: "Processing resumed from saved progress" },
        { timestamp: "2026-09-01T10:04:00.000Z", activity: "Reused the previously extracted page result after processing resumed", toolLabel: "run_ocr" },
        { timestamp: "2026-09-01T10:05:00.000Z", activity: "Generated review report" },
      ],
    })),
    getIssues: vi.fn(async () => [{
      issueId: "4c816f67-5f2f-4e21-8c17-7eb1e53838be",
      origin: "agent" as const,
      code: "VAL_EMPLOYER_CONSISTENCY_001",
      description: "The employers differ.",
      recommendedAction: "Confirm the current employer.",
      reviewState: "pending" as const,
      version: 1,
      supportingReferences: [],
      editRevision: 0,
    }]),
    getEvidence: vi.fn(async () => ({
      evidenceId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
      evidenceType: "structured_input" as const,
      jsonPointer: "/applicant_display_name",
      extractionMethod: "structured_input",
      processorVersion: "application-schema-1.0.0",
    })),
    listEvidence: vi.fn(async () => [{
      evidenceId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
      evidenceType: "structured_input" as const,
      jsonPointer: "/applicant_display_name",
      extractionMethod: "structured_input",
      processorVersion: "application-schema-1.0.0",
    }]),
    getFindings: vi.fn(async () => [{
      findingId: "4c816f67-5f2f-4e21-8c17-7eb1e5383996",
      ruleId: "VAL_NAME_CONSISTENCY_001", ruleVersion: "1.0.0",
      status: "passed" as const, reasonCode: "NAME_CONSISTENT",
      references: ["/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence/4c816f67-5f2f-4e21-8c17-7eb1e5383999"],
    }]),
    getApplicationData: vi.fn(async () => ({
      groups: [
        { group: "applicant" as const, fields: [{ key: "display_name", displayValue: "Anna Beispiel", jsonPointer: "/applicant_display_name" }] },
        { group: "contact" as const, fields: [{ key: "email", displayValue: "a***@example.invalid", jsonPointer: "/contact/email" }] },
      ],
      submissionHistory: {
        initialSubmittedAt: "2026-09-01T10:00:00.000Z",
        latestSubmittedAt: "2026-09-02T10:00:00.000Z",
        applicationDataUpdatedAt: "2026-09-02T10:00:00.000Z",
      },
    })),
    getDocuments: vi.fn(async () => [{
      documentId: "4c816f67-5f2f-4e21-8c17-7eb1e5383998",
      physicalDocumentId: "4c816f67-5f2f-4e21-8c17-7eb1e5383997",
      version: 1, submittedFilename: "statement.pdf", mediaType: "application/pdf", pageCount: 1,
    }]),
    getSourceDocumentArtifact: vi.fn(async () => ({
      objectKey: "source/document-1", byteSize: 14, mediaType: "application/pdf" as const,
    })),
    getDocumentPage: vi.fn(async () => ({
      documentId: "4c816f67-5f2f-4e21-8c17-7eb1e5383998",
      pageNumber: 1, needsOcr: false, hasTable: true, hasColumns: false, nativeCharacterCount: 42,
      nativeTextAvailable: true, renderAvailable: true,
    })),
    getNativeTextArtifact: vi.fn(async () => ({ objectKey: "derived/native/page-1", byteSize: 16, mediaType: "text/markdown" as const })),
    getPageRenderArtifact: vi.fn(async () => ({ objectKey: "derived/render/page-1", byteSize: 8, mediaType: "image/png" as const })),
    getDownstreamHandoff: vi.fn(async () => ({
      caseId: "4c816f67-5f2f-4e21-8c17-7eb1e53838bd",
      status: "ready_for_handoff" as const,
      resultRevision: { id: "4c816f67-5f2f-4e21-8c17-7eb1e5383995", revision: 1, sealedAt: "2026-09-01T10:05:00.000Z" },
      finalReview: { id: "4c816f67-5f2f-4e21-8c17-7eb1e5383993", action: "clear_for_downstream" as const,
        reviewerId: "reviewer_1", completedAt: "2026-09-01T10:10:00.000Z", resultingCaseVersion: 3 },
      recommendedDisposition: { value: "human_review_required" as const, policyId: "demo-policy", policyVersion: "1.0.0" },
      claims: [{ claimId: "4c816f67-5f2f-4e21-8c17-7eb1e5383997", fieldSchemaId: "employment.employer", valueType: "string",
        normalizedValue: "Beispieltechnik GmbH", normalizationVersion: "1.0.0",
        evidenceReferences: ["/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence/4c816f67-5f2f-4e21-8c17-7eb1e5383999"] }],
      findings: [{ findingId: "4c816f67-5f2f-4e21-8c17-7eb1e5383996", ruleId: "VAL_NAME_CONSISTENCY_001",
        ruleVersion: "1.0.0", status: "passed" as const, reasonCode: "NAME_CONSISTENT", references: [] }],
    })),
  };

  it("accepts work asynchronously", async () => {
    const accept = vi.fn(async () => ({ caseId: "case_1", runId: "run_1", replayed: false }));
    const app = buildApp({ accept }, caseQueries);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cases",
      headers: { "idempotency-key": "intake_1" },
      payload: { applicant_display_name: "Anna Beispiel" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ case_id: "case_1", lifecycle: "processing" });
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      applicationData: { applicant_display_name: "Anna Beispiel" },
    }));
    await app.close();
  });

  it("exposes only allowlisted demo Agent models and binds the selected model", async () => {
    const accept = vi.fn(async () => ({ caseId: "case_1", runId: "run_1", replayed: false }));
    const models = { defaultModel: "openai/gpt-5.6-terra", models: [
      { id: "openai/gpt-5.6-terra", label: "openai/gpt-5.6-terra", paid: true, maximumCaseCostUsd: "0.25" },
      { id: "fake", label: "Deterministic demo Agent", paid: false },
    ] };
    const app = buildApp({ accept }, caseQueries, { store: vi.fn(async (source) => {
      for await (const _ of source) void _;
      return { objectKey: "source/object_1", sha256: "a".repeat(64), byteSize: 13, detectedMediaType: "application/pdf" as const };
    }), discard: vi.fn() }, undefined, undefined, models);
    const configuration = await app.inject({ method: "GET", url: "/api/v1/demo/agent-models" });
    expect(configuration.json()).toMatchObject({ default_model: "openai/gpt-5.6-terra" });
    expect(configuration.json().models).toEqual(expect.arrayContaining([expect.objectContaining({ paid: true, maximum_case_cost_usd: "0.25" })]));
    const response = await app.inject({
      method: "POST", url: "/api/v1/cases",
      headers: { "idempotency-key": "selected_model", "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartPayload("openai/gpt-5.6-terra"),
    });
    expect(response.statusCode).toBe(202);
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ agentModel: "openai/gpt-5.6-terra" }));
    await app.close();
  });

  it("returns the versioned read-only downstream handoff projection", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({
      method: "GET", url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/downstream-handoff",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready_for_handoff",
      final_review: { action: "clear_for_downstream", reviewer_id: "reviewer_1" },
      claims: [{ field_schema_id: "employment.employer", evidence_references: [expect.stringContaining("/evidence/")] }],
      findings: [{ rule_id: "VAL_NAME_CONSISTENCY_001" }],
    });
    await app.close();
  });

  it("returns the bounded reviewer-safe case Agent log", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({
      method: "GET", url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/agent-log",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      availability: "ready", model_label: "fake-pi-harness-v1",
      estimated_cost: { amount: "0.0000", currency: "EUR" }, current_step: "awaiting_human_review",
      session: { harness_label: "pi-agent-led-case-review-harness (pi-coding-agent@0.85.1)", mode: "case_review", status: "terminal", terminal_reason: "report_submitted", attempts: 2, iterations: 3, tool_calls: 3, model_calls: 4, usage_available: true, input_tokens: 1200, output_tokens: 300, duration_ms: 5000 },
      events: [
        { timestamp: "2026-09-01T10:03:00.000Z", activity: "Processing resumed from saved progress" },
        { timestamp: "2026-09-01T10:04:00.000Z", activity: "Reused the previously extracted page result after processing resumed", tool_label: "run_ocr" },
        { timestamp: "2026-09-01T10:05:00.000Z", activity: "Generated review report" },
      ],
    });
    await app.close();
  });

  it("does not expose a handoff before document review is cleared", async () => {
    const unavailableQueries = { ...caseQueries, getDownstreamHandoff: vi.fn(async () => { throw new HandoffUnavailableError(); }) };
    const app = buildApp({ accept: vi.fn() }, unavailableQueries);
    const response = await app.inject({
      method: "GET", url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/downstream-handoff",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "handoff_unavailable" });
    await app.close();
  });

  it("returns a stable conflict for incompatible idempotent replay", async () => {
    const app = buildApp({ accept: vi.fn(async () => { throw new IdempotencyConflictError(); }) }, caseQueries);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cases",
      headers: { "idempotency-key": "reused" },
      payload: { applicant_display_name: "Different Applicant" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "idempotency_conflict" });
    await app.close();
  });

  it("returns the authoritative polling projection with lazy resource links", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      case_code: "FD-2026-0042",
      lifecycle: "processing",
      result_availability: "pending",
      links: { agent_report: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/agent-report" },
    });
    await app.close();
  });

  it("returns the requested reviewer queue projection", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({ method: "GET", url: "/api/v1/cases?view=changes_requested" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cases: [{ case_code: "FD-2026-0042", applicant_display_name: "Anna Beispiel", issue_count: 1 }] });
    expect(caseQueries.list).toHaveBeenCalledWith("changes_requested");
    await app.close();
  });

  it("returns the verified report, review issues, and deterministic findings", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const base = "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd";
    const [report, issues, findings] = await Promise.all([
      app.inject({ method: "GET", url: `${base}/agent-report` }),
      app.inject({ method: "GET", url: `${base}/issues` }),
      app.inject({ method: "GET", url: `${base}/findings` }),
    ]);
    expect(report.json()).toMatchObject({
      availability: "ready",
      result_revision: { id: "4c816f67-5f2f-4e21-8c17-7eb1e5383995", revision: 1 },
      issue_links: ["issue_1"],
    });
    expect(issues.json()).toMatchObject({ issues: [{ review_state: "pending" }] });
    expect(findings.json()).toMatchObject({ findings: [{ rule_id: "VAL_NAME_CONSISTENCY_001", status: "passed" }] });
    await app.close();
  });

  it("returns a scoped evidence projection without internal object-store locations", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence/4c816f67-5f2f-4e21-8c17-7eb1e5383999",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      evidence_id: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
      evidence_type: "structured_input",
      json_pointer: "/applicant_display_name",
      extraction_method: "structured_input",
      processor_version: "application-schema-1.0.0",
    });
    await app.close();
  });

  it("returns source-page geometry for precise page-region evidence", async () => {
    caseQueries.getEvidence.mockResolvedValueOnce({
      evidenceId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999", evidenceType: "page_region" as const,
      documentVersionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383998", pageNumber: 2,
      pageWidth: 1200, pageHeight: 1600, pageRotation: 0,
      normalizedRegion: { x: 0.2, y: 0.6, width: 0.25, height: 0.04 },
      originalRegion: { left: 240, top: 960, width: 300, height: 64 },
      coordinateUnit: "render_pixel" as const, coordinateOrigin: "top_left" as const,
      extractionMethod: "agent_vlm_extraction", processorVersion: "openai/gpt-5.6-terra",
    } as never);
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({ method: "GET", url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence/4c816f67-5f2f-4e21-8c17-7eb1e5383999" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ evidence_type: "page_region", page_number: 2,
      normalized_region: { x: 0.2, y: 0.6, width: 0.25, height: 0.04 } });
    await app.close();
  });

  it("lists evidence available to the current case", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ evidence: [{ evidence_type: "structured_input", json_pointer: "/applicant_display_name" }] });
    await app.close();
  });

  it("returns masked application data and current document page metadata", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const base = "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd";
    const [applicationData, documents, page] = await Promise.all([
      app.inject({ method: "GET", url: `${base}/application-data` }),
      app.inject({ method: "GET", url: `${base}/documents` }),
      app.inject({ method: "GET", url: `${base}/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/pages/1` }),
    ]);
    expect(applicationData.json()).toMatchObject({ groups: [{ group: "applicant" }, { group: "contact", fields: [{ display_value: "a***@example.invalid" }] }] });
    expect(documents.json()).toMatchObject({ documents: [{
      submitted_filename: "statement.pdf", page_count: 1,
      content_url: `${base}/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/content`,
    }] });
    expect(page.json()).toMatchObject({
      page_number: 1, has_table: true, native_character_count: 42, render_available: true,
      render_url: `${base}/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/pages/1/render`,
    });
    await app.close();
  });

  it("streams authorized native page text without exposing its object key", async () => {
    const artifactStore = {
      put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
      get: vi.fn(async () => (async function* () { yield Buffer.from("# Synthetic page"); })()),
    };
    const app = buildApp({ accept: vi.fn() }, caseQueries, undefined, undefined, artifactStore);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/pages/1/native-text",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.body).toBe("# Synthetic page");
    expect(response.body).not.toContain("derived/native/page-1");
    await app.close();
  });

  it("streams an authorized immutable page render", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const artifactStore = {
      put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
      get: vi.fn(async () => (async function* () { yield png; })()),
    };
    const app = buildApp({ accept: vi.fn() }, caseQueries, undefined, undefined, artifactStore);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/pages/1/render",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.rawPayload).toEqual(png);
    await app.close();
  });

  it("streams the case-scoped source document without exposing its object key", async () => {
    const artifactStore = {
      put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
      get: vi.fn(async () => (async function* () { yield Buffer.from("%PDF-synthetic"); })()),
    };
    const app = buildApp({ accept: vi.fn() }, caseQueries, undefined, undefined, artifactStore);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/content",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toBe("%PDF-synthetic");
    expect(response.body).not.toContain("source/document-1");
    await app.close();
  });

  it("persists issue review, requested-change draft, and final request-changes command", async () => {
    const reviewCommands = {
      createIssue: vi.fn(async () => ({ issueId: "4c816f67-5f2f-4e21-8c17-7eb1e5383992", issueVersion: 1, caseVersion: 3 })),
      editIssue: vi.fn(async () => ({ issueVersion: 2 })),
      resolveIssue: vi.fn(async () => ({ issueVersion: 2, reviewState: "confirmed" as const })),
      saveRequestedChange: vi.fn(async () => ({ draftRevisionId: "4c816f67-5f2f-4e21-8c17-7eb1e5383994", revision: 1 })),
      submitFinalReview: vi.fn(async () => ({
        finalReviewId: "4c816f67-5f2f-4e21-8c17-7eb1e5383993", caseVersion: 3, action: "request_changes" as const,
      })),
    };
    const app = buildApp({ accept: vi.fn() }, caseQueries, undefined, reviewCommands);
    const base = "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd";
    const issueId = "4c816f67-5f2f-4e21-8c17-7eb1e53838be";
    const resultRevisionId = "4c816f67-5f2f-4e21-8c17-7eb1e5383995";
    const created = await app.inject({ method: "POST", url: `${base}/issues`, payload: {
      result_revision_id: resultRevisionId, command_id: "create_1", expected_case_version: 2,
      title: "Missing page", description: "A reviewer observed a missing page.", recommended_action: "Please provide the missing page.",
      supporting_references: [], no_reference_reason: "Visible gap in the submitted package.",
    } });
    expect(created.statusCode).toBe(200);
    const edited = await app.inject({ method: "PATCH", url: `${base}/issues/${issueId}`, payload: {
      result_revision_id: resultRevisionId, command_id: "edit_1", expected_issue_version: 1,
      title: "Employer mismatch", description: "The employer names differ.", recommended_action: "Please confirm the current employer.",
      supporting_references: [], no_reference_reason: "Reviewer comparison.",
    } });
    expect(edited.statusCode).toBe(200);
    const confirmed = await app.inject({ method: "POST", url: `${base}/issues/${issueId}/confirm`, payload: {
      result_revision_id: resultRevisionId, command_id: "confirm_1", expected_issue_version: 1,
    } });
    expect(confirmed.statusCode).toBe(200);
    const ignored = await app.inject({ method: "POST", url: `${base}/issues/${issueId}/ignore`, payload: {
      result_revision_id: resultRevisionId, command_id: "ignore_1", expected_issue_version: 1,
    } });
    expect(ignored.statusCode).toBe(200);
    expect(reviewCommands.resolveIssue).toHaveBeenCalledWith(expect.objectContaining({ action: "dismiss_signal" }));
    expect(reviewCommands.resolveIssue).toHaveBeenLastCalledWith(expect.not.objectContaining({ reason: expect.anything() }));
    const draft = await app.inject({ method: "PUT", url: `${base}/issues/${issueId}/requested-change`, payload: {
      result_revision_id: resultRevisionId, command_id: "draft_1", text: "Please provide a current document.", included: true,
    } });
    expect(draft.statusCode).toBe(200);
    const final = await app.inject({ method: "POST", url: `${base}/final-review`, payload: {
      result_revision_id: resultRevisionId, command_id: "final_1", expected_case_version: 2,
      action: "request_changes", selected_draft_revision_ids: [draft.json().draft_revision_id],
    } });
    expect(final.statusCode).toBe(200);
    expect(final.json()).toMatchObject({ action: "request_changes", case_version: 3 });
    expect(reviewCommands.submitFinalReview).toHaveBeenCalledWith(expect.objectContaining({ action: "request_changes" }));
    await app.close();
  });

  it("streams multipart documents through source intake before accepting the case", async () => {
    const accept = vi.fn(async () => ({ caseId: "case_1", runId: "run_1", replayed: false }));
    let uploaded = Buffer.alloc(0);
    const store = vi.fn(async (source: AsyncIterable<Uint8Array>) => {
      for await (const chunk of source) uploaded = Buffer.concat([uploaded, Buffer.from(chunk)]);
      return {
        objectKey: "source/object_1", sha256: "a".repeat(64), byteSize: uploaded.byteLength,
        detectedMediaType: "application/pdf" as const,
      };
    });
    const discard = vi.fn(async () => undefined);
    const app = buildApp({ accept }, caseQueries, { store, discard });
    const response = await app.inject({
      method: "POST", url: "/api/v1/cases",
      headers: { "idempotency-key": "multipart_1", "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartPayload(),
    });

    expect(response.statusCode).toBe(202);
    expect(store).toHaveBeenCalledOnce();
    expect(uploaded.toString()).toBe("%PDF-1.7\nDEMO");
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      applicantDisplayName: "Anna Beispiel",
      applicationData: { applicant_display_name: "Anna Beispiel", demo_fixture_id: "anna-example-v1" },
      documents: [expect.objectContaining({ submittedFilename: "statement.pdf" })],
    }));
    await app.close();
  });

  it("discards a newly uploaded object after an idempotent replay", async () => {
    const artifact = { objectKey: "source/retry", sha256: "b".repeat(64), byteSize: 13, detectedMediaType: "application/pdf" as const };
    const discard = vi.fn(async () => undefined);
    const app = buildApp({
      accept: vi.fn(async () => ({ caseId: "case_original", runId: "run_original", replayed: true })),
    }, caseQueries, {
      store: async (source) => { for await (const _ of source) void _; return artifact; },
      discard,
    });
    const response = await app.inject({
      method: "POST", url: "/api/v1/cases",
      headers: { "idempotency-key": "retry", "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartPayload(),
    });

    expect(response.statusCode).toBe(202);
    expect(discard).toHaveBeenCalledWith(artifact);
    await app.close();
  });

  it("discards uploaded objects when database acceptance fails", async () => {
    const artifact = { objectKey: "source/failed", sha256: "c".repeat(64), byteSize: 13, detectedMediaType: "application/pdf" as const };
    const discard = vi.fn(async () => undefined);
    const app = buildApp({ accept: vi.fn(async () => { throw new Error("database unavailable"); }) }, caseQueries, {
      store: async (source) => { for await (const _ of source) void _; return artifact; },
      discard,
    });
    const response = await app.inject({
      method: "POST", url: "/api/v1/cases",
      headers: { "idempotency-key": "failed", "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartPayload(),
    });

    expect(response.statusCode).toBe(500);
    expect(discard).toHaveBeenCalledWith(artifact);
    await app.close();
  });
});
