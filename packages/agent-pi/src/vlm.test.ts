import { describe, expect, it } from "vitest";
import { parseVlmText } from "./vlm.js";

describe("VLM response validation", () => {
  it("accepts one bounded raw value and normalized region", () => {
    expect(parseVlmText('{"value":"2.980,00 EUR"}', { x: 0.1, y: 0.2, width: 0.3, height: 0.1 })).toEqual({
      rawValue: "2.980,00 EUR",
      normalizedValue: "2.980,00 EUR",
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
      rawConfidence: 0,
    });
  });

  it("represents an absent field without inventing a value", () => {
    expect(parseVlmText("```json\n{\"value\":null}\n```")).toBeUndefined();
  });

  it("rejects malformed output", () => {
    expect(() => parseVlmText('{"value":42}')).toThrow("invalid");
    expect(() => parseVlmText('{"value":"x","explanation":"guess"}')).toThrow("unapproved");
  });
});
