import { describe, expect, it, vi } from "vitest";
import { IdempotencyConflictError } from "@findoc/core";
import { buildApp } from "./app.js";

const boundary = "findoc-test-boundary";
function multipartPayload() {
  return Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="application_data"\r\n\r\n`,
    JSON.stringify({ applicant_display_name: "Anna Beispiel", demo_fixture_id: "anna-example-v1" }),
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="documents"; filename="statement.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    "%PDF-1.7\nDEMO",
    `\r\n--${boundary}--\r\n`,
  ].join(""));
}

describe("case intake", () => {
  const caseQueries = {
    get: vi.fn(async () => ({
      caseId: "4c816f67-5f2f-4e21-8c17-7eb1e53838bd",
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
        statement: "The applicant name is consistent.", sourceType: "deterministic_check" as const,
        status: "passed" as const,
        references: ["/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/evidence/4c816f67-5f2f-4e21-8c17-7eb1e5383999"],
      }],
    })),
    getIssues: vi.fn(async () => [{
      issueId: "4c816f67-5f2f-4e21-8c17-7eb1e53838be",
      origin: "agent" as const,
      code: "VAL_EMPLOYER_CONSISTENCY_001",
      description: "The employers differ.",
      recommendedAction: "Confirm the current employer.",
      reviewState: "pending" as const,
      version: 1,
    }]),
    getEvidence: vi.fn(async () => ({
      evidenceId: "4c816f67-5f2f-4e21-8c17-7eb1e5383999",
      evidenceType: "structured_input" as const,
      jsonPointer: "/applicant_display_name",
      extractionMethod: "structured_input",
      processorVersion: "application-schema-1.0.0",
    })),
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
    getDocumentPage: vi.fn(async () => ({
      documentId: "4c816f67-5f2f-4e21-8c17-7eb1e5383998",
      pageNumber: 1, needsOcr: false, hasTable: true, hasColumns: false, nativeCharacterCount: 42,
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
      lifecycle: "processing",
      result_availability: "pending",
      links: { agent_report: "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd/agent-report" },
    });
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

  it("returns masked application data and current document page metadata", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const base = "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd";
    const [applicationData, documents, page] = await Promise.all([
      app.inject({ method: "GET", url: `${base}/application-data` }),
      app.inject({ method: "GET", url: `${base}/documents` }),
      app.inject({ method: "GET", url: `${base}/documents/4c816f67-5f2f-4e21-8c17-7eb1e5383998/pages/1` }),
    ]);
    expect(applicationData.json()).toMatchObject({ groups: [{ group: "applicant" }, { group: "contact", fields: [{ display_value: "a***@example.invalid" }] }] });
    expect(documents.json()).toMatchObject({ documents: [{ submitted_filename: "statement.pdf", page_count: 1 }] });
    expect(page.json()).toMatchObject({ page_number: 1, has_table: true, native_character_count: 42 });
    await app.close();
  });

  it("persists issue review, requested-change draft, and final request-changes command", async () => {
    const reviewCommands = {
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
    const confirmed = await app.inject({ method: "POST", url: `${base}/issues/${issueId}/confirm`, payload: {
      result_revision_id: resultRevisionId, command_id: "confirm_1", expected_issue_version: 1,
    } });
    expect(confirmed.statusCode).toBe(200);
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
