import { describe, expect, it } from "vitest";
import { DEMO_RULE_SET, RuleManifestError, evaluateRuleSet, mapDisposition, type ValidationInput } from "./index.js";

function validInput(): ValidationInput {
  return {
    inputSnapshotId: "input-1", resultRevisionId: "result-1", referenceDate: "2026-09-05",
    requiredStagesSucceeded: true, unresolvedRequiredGap: false,
    documents: [
      { type: "identity_document", usability: "usable", reference: "evidence:id" },
      { type: "payslip", usability: "usable", reference: "evidence:pay" },
      { type: "bank_statement", usability: "usable", reference: "evidence:bank" },
    ],
    personMatches: [
      { role: "identity_holder", result: "match", references: ["claim:id-name"] },
      { role: "employee", result: "match", references: ["claim:pay-name"] },
      { role: "account_holder", result: "match", references: ["claim:bank-name"] },
    ],
    organizationMatches: [{ role: "payslip_employer", result: "match", qualified: true, references: ["claim:employer"] }],
    incomes: [
      { role: "declared", amount: "3480.00", currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: true, references: ["claim:declared-income"] },
      { role: "payslip", amount: "3480.00", currency: "EUR", basis: "net", period: "monthly", evidenceSufficient: true, references: ["claim:payslip-income"] },
    ],
    identityExpiry: { fullDate: "2030-01-01", holderResolved: true, evidenceSufficient: true, references: ["claim:id-expiry"] },
  };
}

describe("registered validation rules", () => {
  it("evaluates all five rules and produces the ready document-processing disposition", () => {
    const input = validInput();
    const findings = evaluateRuleSet(input);
    expect(findings.map((item) => [item.ruleId, item.status])).toEqual([
      ["VAL_DOC_COMPLETENESS_001", "passed"], ["VAL_NAME_CONSISTENCY_001", "passed"],
      ["VAL_EMPLOYER_CONSISTENCY_001", "passed"], ["VAL_INCOME_CONSISTENCY_001", "passed"],
      ["VAL_ID_EXPIRY_001", "passed"],
    ]);
    expect(mapDisposition(input, findings)).toBe("ready_for_downstream_processing");
  });

  it("keeps conflicts separate from processing failure", () => {
    const input = { ...validInput(), organizationMatches: [{ role: "payslip_employer" as const, result: "mismatch" as const, qualified: true, references: ["claim:employer"] }] };
    const findings = evaluateRuleSet(input);
    expect(findings.find((item) => item.ruleId === "VAL_EMPLOYER_CONSISTENCY_001")).toMatchObject({ status: "failed", reasonCode: "employer_conflict" });
    expect(mapDisposition(input, findings)).toBe("human_review_required");
  });

  it("gives missing required documents disposition precedence", () => {
    const input = { ...validInput(), documents: validInput().documents.filter((item) => item.type !== "bank_statement") };
    expect(mapDisposition(input, evaluateRuleSet(input))).toBe("additional_documents_needed");
  });

  it("fails closed for duplicate manifest entries", () => {
    const duplicate = { ...DEMO_RULE_SET, rules: [...DEMO_RULE_SET.rules, DEMO_RULE_SET.rules[0]!] };
    expect(() => evaluateRuleSet(validInput(), duplicate)).toThrow(RuleManifestError);
  });

  it("uses exact decimal comparison and an explicit reference date", () => {
    const input = {
      ...validInput(), referenceDate: "2031-01-01",
      incomes: [
        { role: "declared" as const, amount: "3480.00", currency: "EUR", basis: "net" as const, period: "monthly" as const, evidenceSufficient: true, references: ["claim:a"] },
        { role: "payslip" as const, amount: "3480.01", currency: "EUR", basis: "net" as const, period: "monthly" as const, evidenceSufficient: true, references: ["claim:b"] },
      ],
    };
    const findings = evaluateRuleSet(input);
    expect(findings.find((item) => item.ruleId === "VAL_INCOME_CONSISTENCY_001")).toMatchObject({ status: "failed", reasonCode: "income_conflict" });
    expect(findings.find((item) => item.ruleId === "VAL_ID_EXPIRY_001")).toMatchObject({ status: "failed", reasonCode: "identity_document_expired" });
  });
});
