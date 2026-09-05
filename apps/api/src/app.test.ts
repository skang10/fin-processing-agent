import { describe, expect, it, vi } from "vitest";
import { IdempotencyConflictError } from "@findoc/core";
import { buildApp } from "./app.js";

describe("case intake", () => {
  it("accepts work asynchronously", async () => {
    const accept = vi.fn(async () => ({ caseId: "case_1", runId: "run_1" }));
    const app = buildApp({ accept });
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
    const app = buildApp({ accept: vi.fn(async () => { throw new IdempotencyConflictError(); }) });
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
});
