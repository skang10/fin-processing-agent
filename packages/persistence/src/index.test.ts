import { describe, expect, it } from "vitest";
import { hashIntake } from "./index.js";

describe("case intake hashing", () => {
  it("excludes the transport retry key from the canonical request hash", () => {
    const first = hashIntake({ applicantDisplayName: "Anna Beispiel", idempotencyKey: "one" });
    const retry = hashIntake({ applicantDisplayName: "Anna Beispiel", idempotencyKey: "two" });
    expect(first).toBe(retry);
  });
});
