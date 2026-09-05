import { describe, expect, it } from "vitest";
import { hashIntake } from "./index.js";

describe("case intake hashing", () => {
  it("excludes the transport retry key from the canonical request hash", () => {
    const applicationData = { applicant_display_name: "Anna Beispiel" };
    const first = hashIntake({ applicantDisplayName: "Anna Beispiel", applicationData, idempotencyKey: "one" });
    const retry = hashIntake({ applicantDisplayName: "Anna Beispiel", applicationData, idempotencyKey: "two" });
    expect(first).toBe(retry);
  });
});
