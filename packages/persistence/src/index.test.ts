import { describe, expect, it } from "vitest";
import { hashIntake } from "./index.js";

describe("case intake hashing", () => {
  it("excludes the transport retry key from the canonical request hash", () => {
    const applicationData = { applicant_display_name: "Anna Beispiel" };
    const first = hashIntake({ applicantDisplayName: "Anna Beispiel", applicationData, agentModel: "fake", idempotencyKey: "one" });
    const retry = hashIntake({ applicantDisplayName: "Anna Beispiel", applicationData, agentModel: "fake", idempotencyKey: "two" });
    expect(first).toBe(retry);
    expect(hashIntake({ applicantDisplayName: "Anna Beispiel", applicationData, agentModel: "openai/gpt-5.6-terra", idempotencyKey: "three" })).not.toBe(first);
  });
});
