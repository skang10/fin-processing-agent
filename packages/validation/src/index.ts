export const RULE_IDS = [
  "VAL_DOC_COMPLETENESS_001",
  "VAL_NAME_CONSISTENCY_001",
  "VAL_EMPLOYER_CONSISTENCY_001",
  "VAL_INCOME_CONSISTENCY_001",
  "VAL_ID_EXPIRY_001",
] as const;

export type RuleId = typeof RULE_IDS[number];
export type FindingStatus = "passed" | "warning" | "failed" | "inconclusive" | "not_applicable";
export type RecommendedDisposition = "ready_for_downstream_processing" | "additional_documents_needed" | "human_review_required";
export type MatchResult = "match" | "mismatch" | "ambiguous" | "missing" | "unsupported";

export interface ValidationFinding {
  readonly ruleId: RuleId;
  readonly ruleVersion: "1.0.0";
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  readonly inputSnapshotId: string;
  readonly resultRevisionId: string;
  readonly status: FindingStatus;
  readonly reasonCode: string;
  readonly materialInputRefs: readonly string[];
}

export interface ValidationInput {
  readonly inputSnapshotId: string;
  readonly resultRevisionId: string;
  readonly referenceDate: string;
  readonly requiredStagesSucceeded: boolean;
  readonly unresolvedRequiredGap: boolean;
  readonly documents: readonly {
    type: "identity_document" | "payslip" | "bank_statement";
    usability: "usable" | "uncertain" | "unusable";
    reference: string;
  }[];
  readonly personMatches: readonly {
    role: "identity_holder" | "employee" | "account_holder";
    result: MatchResult;
    references: readonly string[];
  }[];
  readonly organizationMatches: readonly {
    role: "payslip_employer" | "payment_counterparty";
    result: MatchResult;
    qualified: boolean;
    references: readonly string[];
  }[];
  readonly incomes: readonly {
    role: "declared" | "payslip" | "account_credit";
    amount: string;
    currency: string;
    basis: "gross" | "net" | "account_credit" | "unspecified";
    period: "monthly" | "unresolved";
    evidenceSufficient: boolean;
    references: readonly string[];
  }[];
  readonly identityExpiry?: {
    fullDate: string;
    holderResolved: boolean;
    evidenceSufficient: boolean;
    references: readonly string[];
  };
}

interface RuleManifestEntry {
  readonly id: RuleId;
  readonly implementationVersion: "1.0.0";
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface RuleSetManifest {
  readonly id: string;
  readonly version: string;
  readonly schemaVersion: "1.0.0";
  readonly contentHash: string;
  readonly rules: readonly RuleManifestEntry[];
}

interface RulePlugin {
  readonly id: RuleId;
  readonly implementationVersion: "1.0.0";
  evaluate(input: ValidationInput, parameters: Readonly<Record<string, unknown>>): Omit<ValidationFinding, "ruleSetId" | "ruleSetVersion">;
}

export class RuleManifestError extends Error {}
export class ValidationInputError extends Error {}

function finding(input: ValidationInput, ruleId: RuleId, status: FindingStatus, reasonCode: string, references: readonly string[]): Omit<ValidationFinding, "ruleSetId" | "ruleSetVersion"> {
  return {
    ruleId, ruleVersion: "1.0.0", inputSnapshotId: input.inputSnapshotId,
    resultRevisionId: input.resultRevisionId, status, reasonCode,
    materialInputRefs: [...new Set(references)].sort(),
  };
}

function stringArrayParameter(parameters: Readonly<Record<string, unknown>>, name: string): string[] {
  const value = parameters[name];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new RuleManifestError(`Invalid ${name}`);
  return value;
}

const completenessRule: RulePlugin = {
  id: "VAL_DOC_COMPLETENESS_001", implementationVersion: "1.0.0",
  evaluate(input, parameters) {
    const required = stringArrayParameter(parameters, "requiredDocumentTypes");
    const relevant = input.documents.filter((document) => required.includes(document.type));
    const references = relevant.map((document) => document.reference);
    const missing = required.some((type) => !relevant.some((document) => document.type === type));
    if (missing) return finding(input, this.id, "failed", "required_document_missing", references);
    if (relevant.some((document) => document.usability !== "usable")) {
      return finding(input, this.id, "inconclusive", "required_document_uncertain", references);
    }
    return finding(input, this.id, "passed", "required_documents_usable", references);
  },
};

const nameRule: RulePlugin = {
  id: "VAL_NAME_CONSISTENCY_001", implementationVersion: "1.0.0",
  evaluate(input, parameters) {
    const requiredRoles = stringArrayParameter(parameters, "requiredRoles");
    const relevant = input.personMatches.filter((assessment) => requiredRoles.includes(assessment.role));
    const references = relevant.flatMap((assessment) => assessment.references);
    if (requiredRoles.some((role) => !relevant.some((assessment) => assessment.role === role)) || relevant.some((assessment) => assessment.result === "ambiguous" || assessment.result === "missing" || assessment.result === "unsupported")) {
      return finding(input, this.id, "inconclusive", "person_name_unresolved", references);
    }
    if (relevant.some((assessment) => assessment.result === "mismatch")) {
      return finding(input, this.id, "failed", "person_name_conflict", references);
    }
    return finding(input, this.id, "passed", "person_names_consistent", references);
  },
};

const employerRule: RulePlugin = {
  id: "VAL_EMPLOYER_CONSISTENCY_001", implementationVersion: "1.0.0",
  evaluate(input, parameters) {
    if (typeof parameters["requireQualifiedCounterparty"] !== "boolean") throw new RuleManifestError("Invalid requireQualifiedCounterparty");
    const relevant = input.organizationMatches.filter((assessment) => assessment.role === "payslip_employer" || assessment.qualified);
    const references = relevant.flatMap((assessment) => assessment.references);
    const payslip = relevant.find((assessment) => assessment.role === "payslip_employer");
    const counterparties = relevant.filter((assessment) => assessment.role === "payment_counterparty");
    if (!payslip || relevant.some((assessment) => assessment.result === "ambiguous" || assessment.result === "missing" || assessment.result === "unsupported") || (parameters["requireQualifiedCounterparty"] && counterparties.length === 0)) {
      return finding(input, this.id, "inconclusive", "employer_input_unresolved", references);
    }
    if (relevant.some((assessment) => assessment.result === "mismatch")) {
      return finding(input, this.id, "failed", "employer_conflict", references);
    }
    return finding(input, this.id, "passed", "employers_consistent", references);
  },
};

function parseCents(value: string): bigint | undefined {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return undefined;
  const sign = match[1] === "-" ? -1n : 1n;
  return sign * (BigInt(match[2] ?? "0") * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}

const incomeRule: RulePlugin = {
  id: "VAL_INCOME_CONSISTENCY_001", implementationVersion: "1.0.0",
  evaluate(input, parameters) {
    const tolerance = parameters["absoluteTolerance"];
    if (typeof tolerance !== "string" || parseCents(tolerance) === undefined) throw new RuleManifestError("Invalid absoluteTolerance");
    const references = input.incomes.flatMap((income) => income.references);
    if (input.incomes.length < 2 || input.incomes.some((income) => !income.evidenceSufficient || income.currency !== "EUR" || income.period !== "monthly" || income.basis === "unspecified")) {
      return finding(input, this.id, "inconclusive", "income_input_incomparable", references);
    }
    const comparable = input.incomes.filter((income) => income.basis === "net");
    const values = comparable.map((income) => parseCents(income.amount));
    if (comparable.length < 2 || values.some((value) => value === undefined)) {
      return finding(input, this.id, "inconclusive", "income_input_incomparable", references);
    }
    const cents = values as bigint[];
    const spread = cents.reduce((maximum, value) => value > maximum ? value : maximum) - cents.reduce((minimum, value) => value < minimum ? value : minimum);
    if (spread > (parseCents(tolerance) as bigint)) return finding(input, this.id, "failed", "income_conflict", references);
    return finding(input, this.id, "passed", "income_values_consistent", references);
  },
};

function parseFullDate(value: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return undefined;
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== Number(parts[1]) || parsed.getUTCMonth() + 1 !== Number(parts[2]) || parsed.getUTCDate() !== Number(parts[3])) return undefined;
  return timestamp;
}

const expiryRule: RulePlugin = {
  id: "VAL_ID_EXPIRY_001", implementationVersion: "1.0.0",
  evaluate(input) {
    const expiry = input.identityExpiry;
    const referenceDate = parseFullDate(input.referenceDate);
    const expiryDate = expiry ? parseFullDate(expiry.fullDate) : undefined;
    const references = expiry?.references ?? [];
    if (!expiry || !expiry.holderResolved || !expiry.evidenceSufficient || expiryDate === undefined || referenceDate === undefined) {
      return finding(input, this.id, "inconclusive", "identity_expiry_unresolved", references);
    }
    if (expiryDate < referenceDate) return finding(input, this.id, "failed", "identity_document_expired", references);
    return finding(input, this.id, "passed", "identity_document_current", references);
  },
};

const REGISTRY: ReadonlyMap<RuleId, RulePlugin> = new Map([
  completenessRule, nameRule, employerRule, incomeRule, expiryRule,
].map((plugin) => [plugin.id, Object.freeze(plugin)]));

const DEMO_RULE_ENTRIES: readonly RuleManifestEntry[] = ([
  { id: "VAL_DOC_COMPLETENESS_001", implementationVersion: "1.0.0", parameters: Object.freeze({ requiredDocumentTypes: Object.freeze(["identity_document", "payslip", "bank_statement"]) }) },
  { id: "VAL_NAME_CONSISTENCY_001", implementationVersion: "1.0.0", parameters: Object.freeze({ requiredRoles: Object.freeze(["identity_holder", "employee", "account_holder"]) }) },
  { id: "VAL_EMPLOYER_CONSISTENCY_001", implementationVersion: "1.0.0", parameters: Object.freeze({ requireQualifiedCounterparty: false }) },
  { id: "VAL_INCOME_CONSISTENCY_001", implementationVersion: "1.0.0", parameters: Object.freeze({ absoluteTolerance: "0.00" }) },
  { id: "VAL_ID_EXPIRY_001", implementationVersion: "1.0.0", parameters: Object.freeze({}) },
] satisfies RuleManifestEntry[]).map((entry) => Object.freeze(entry));

export const DEMO_RULE_SET: RuleSetManifest = Object.freeze({
  id: "demo-de-personal-loan-v1", version: "1.0.0", schemaVersion: "1.0.0",
  contentHash: "sha256:a38ad51c4093ee6a6027d86d20bbb06a44cf8f8d9bf5509d41fd6a445502be0d",
  rules: Object.freeze(DEMO_RULE_ENTRIES),
});

export function evaluateRuleSet(input: ValidationInput, manifest: RuleSetManifest = DEMO_RULE_SET): readonly ValidationFinding[] {
  if (!input.requiredStagesSucceeded) throw new ValidationInputError("Required processing stages are incomplete");
  const seen = new Set<RuleId>();
  return manifest.rules.map((entry) => {
    if (seen.has(entry.id)) throw new RuleManifestError(`Duplicate rule ${entry.id}`);
    seen.add(entry.id);
    const plugin = REGISTRY.get(entry.id);
    if (!plugin || plugin.implementationVersion !== entry.implementationVersion) throw new RuleManifestError(`Unknown rule ${entry.id}`);
    return { ...plugin.evaluate(input, entry.parameters), ruleSetId: manifest.id, ruleSetVersion: manifest.version };
  });
}

export function mapDisposition(input: ValidationInput, findings: readonly ValidationFinding[]): RecommendedDisposition {
  if (!input.requiredStagesSucceeded || findings.length !== DEMO_RULE_SET.rules.length) throw new ValidationInputError("Cannot map an incomplete result");
  if (findings.some((item) => item.ruleId === "VAL_DOC_COMPLETENESS_001" && item.status === "failed" && item.reasonCode === "required_document_missing")) {
    return "additional_documents_needed";
  }
  if (input.unresolvedRequiredGap || findings.some((item) => item.status !== "passed" && item.status !== "not_applicable")) {
    return "human_review_required";
  }
  return "ready_for_downstream_processing";
}
