import { describe, expect, it } from "vitest";
import { loadGoldenCase } from "./load-golden.mjs";

describe("golden case loader", () => {
  it("submits the selected candidate and returns its review projection", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push([url, init]);
      if (init?.method === "POST") return Response.json({ case_id: "case-1", status_url: "/api/v1/cases/case-1" }, { status: 202 });
      if (url.endsWith("/case-1")) return Response.json({ lifecycle: "ready_for_review", links: { agent_report: "/report", findings: "/findings", issues: "/issues", documents: "/documents" } });
      if (url.endsWith("/report")) return Response.json({ availability: "ready" });
      if (url.endsWith("/findings")) return Response.json({ findings: Array.from({ length: 5 }) });
      if (url.endsWith("/issues")) return Response.json({ issues: [] });
      return Response.json({ documents: [] });
    };
    const result = await loadGoldenCase("golden-001-native-clear", { fetcher, apiBaseUrl: "http://api", reviewWebUrl: "http://web", wait: async () => {} });
    expect(result).toMatchObject({ case_id: "case-1", lifecycle: "ready_for_review", report_availability: "ready", finding_count: 5, review_url: "http://web/?case_id=case-1" });
    expect(calls[0]?.[1]?.body).toBeInstanceOf(FormData);
  });

  it("retains processing failures instead of presenting them as review-ready", async () => {
    const fetcher = async (_url, init) => init?.method === "POST" ? Response.json({ case_id: "case-2", status_url: "/case-2" }, { status: 202 }) : Response.json({ lifecycle: "processing_exception", links: {} });
    await expect(loadGoldenCase("golden-004-missing-bank-evidence", { fetcher, apiBaseUrl: "http://api", wait: async () => {} })).resolves.toMatchObject({ lifecycle: "processing_exception", report_availability: "unavailable" });
  });

  it("includes the safe public problem detail on intake failure", async () => {
    const fetcher = async () => Response.json({ title: "Internal Server Error", detail: "Object storage unavailable" }, { status: 500 });
    await expect(loadGoldenCase("golden-001-native-clear", { fetcher })).rejects.toThrow("Object storage unavailable");
  });
});
