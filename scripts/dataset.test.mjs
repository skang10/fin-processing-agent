import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildRelease, generateCandidates, inspectCandidates, validateCandidates } from "./dataset.mjs";

describe("golden dataset tooling", () => {
  it("generates, validates, inspects, and freezes only confirmed truth", async () => {
    const root = await mkdtemp(join(tmpdir(), "findoc-dataset-"));
    const candidates = join(root, "candidates");
    const releases = join(root, "releases");
    const document = Buffer.from("%PDF-1.7\nSYNTHETIC DEMO\n%%EOF");
    await writeFile(join(root, "case.pdf"), document);
    const blueprintPath = join(root, "blueprints.json");
    await writeFile(blueprintPath, JSON.stringify({ schema_version: "1.0.0", cases: [candidate("golden-001")] }));

    await expect(generateCandidates(blueprintPath, candidates)).resolves.toHaveLength(1);
    await expect(validateCandidates(candidates, root)).resolves.toHaveLength(1);
    await expect(inspectCandidates(candidates, root)).resolves.toEqual([expect.objectContaining({ case_id: "golden-001", verification: "pending_human_review" })]);
    await expect(buildRelease("v0.1.0", candidates, releases, root)).rejects.toThrow("await human confirmation");

    const path = join(candidates, "golden-001.json");
    const value = JSON.parse(await readFile(path, "utf8"));
    value.verification = { status: "confirmed", verified_by: "human-reviewer", verified_at: "2026-09-06T00:00:00.000Z" };
    await writeFile(path, JSON.stringify(value));
    await mkdir(releases);
    const release = await buildRelease("v0.1.0", candidates, releases, root);
    expect(release).toMatchObject({ case_count: 1, cases: [{ case_id: "golden-001", document_sha256: [{ sha256: createHash("sha256").update(document).digest("hex") }] }] });
  });
});

function candidate(caseId) {
  return {
    case_id: caseId, seed: 101, generator: { version: "test-generator", template_version: "test-template" },
    application_data: { applicant_display_name: "Synthetic Person" },
    documents: [{ path: "case.pdf", media_type: "application/pdf" }],
    verification: { status: "pending_human_review" }, coverage: ["native_text"],
    truth_candidate: {
      expected_issues: [{ code: "VAL_DOC_COMPLETENESS_001", acceptable_evidence: ["document:case.pdf"] }],
      expected_checked_facts: [], required_report_content: ["document review"],
      prohibited_report_content: ["credit decision"], report_availability: "ready",
    },
  };
}
