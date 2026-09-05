import { describe, expect, it, vi } from "vitest";
import { IdempotencyConflictError } from "@findoc/core";
import { buildApp } from "./app.js";

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
      summary: "Three items require review.",
      issueLinks: ["issue_1"],
      checkedFacts: [],
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
  };

  it("accepts work asynchronously", async () => {
    const accept = vi.fn(async () => ({ caseId: "case_1", runId: "run_1" }));
    const app = buildApp({ accept }, caseQueries);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/cases",
      headers: { "idempotency-key": "intake_1" },
      payload: { applicant_display_name: "Anna Beispiel" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ case_id: "case_1", lifecycle: "processing" });
    expect(accept).toHaveBeenCalledOnce();
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

  it("returns the verified report and review issues", async () => {
    const app = buildApp({ accept: vi.fn() }, caseQueries);
    const base = "/api/v1/cases/4c816f67-5f2f-4e21-8c17-7eb1e53838bd";
    const [report, issues] = await Promise.all([
      app.inject({ method: "GET", url: `${base}/agent-report` }),
      app.inject({ method: "GET", url: `${base}/issues` }),
    ]);
    expect(report.json()).toMatchObject({ availability: "ready", issue_links: ["issue_1"] });
    expect(issues.json()).toMatchObject({ issues: [{ review_state: "pending" }] });
    await app.close();
  });

  it("streams multipart documents through source intake before accepting the case", async () => {
    const accept = vi.fn(async () => ({ caseId: "case_1", runId: "run_1" }));
    let uploaded = Buffer.alloc(0);
    const store = vi.fn(async (source: AsyncIterable<Uint8Array>) => {
      for await (const chunk of source) uploaded = Buffer.concat([uploaded, Buffer.from(chunk)]);
      return {
        objectKey: "source/object_1", sha256: "a".repeat(64), byteSize: uploaded.byteLength,
        detectedMediaType: "application/pdf" as const,
      };
    });
    const app = buildApp({ accept }, caseQueries, { store });
    const boundary = "findoc-test-boundary";
    const payload = Buffer.from([
      `--${boundary}\r\nContent-Disposition: form-data; name="application_data"\r\n\r\n`,
      JSON.stringify({ applicant_display_name: "Anna Beispiel" }),
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="documents"; filename="statement.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      "%PDF-1.7\nDEMO",
      `\r\n--${boundary}--\r\n`,
    ].join(""));
    const response = await app.inject({
      method: "POST", url: "/api/v1/cases",
      headers: { "idempotency-key": "multipart_1", "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(store).toHaveBeenCalledOnce();
    expect(uploaded.toString()).toBe("%PDF-1.7\nDEMO");
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({
      applicantDisplayName: "Anna Beispiel",
      documents: [expect.objectContaining({ submittedFilename: "statement.pdf" })],
    }));
    await app.close();
  });
});
