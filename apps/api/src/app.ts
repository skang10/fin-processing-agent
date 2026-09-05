import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CaseAcceptedSchema,
  CaseProjectionSchema,
  AgentReportSchema,
  ProblemDetailsSchema,
  ReviewIssuesSchema,
} from "@findoc/contracts";
import { CaseNotFoundError, IdempotencyConflictError, type CaseCommandService, type CaseQueryService, type CaseReviewQueryService } from "@findoc/core";

export function buildApp(caseCommands: CaseCommandService, caseQueries: CaseQueryService & CaseReviewQueryService) {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onRequest", async (request, reply) => {
    const requestId = request.id;
    void reply.header("X-Request-Id", requestId);
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply.code(409).type("application/problem+json").send({
        type: "https://example.invalid/problems/idempotency_conflict",
        title: "The idempotency key was already used",
        status: 409,
        code: "idempotency_conflict",
        request_id: request.id,
        detail: "Use the original request or submit a new idempotency key.",
      });
    }
    if (error instanceof CaseNotFoundError) {
      return reply.code(404).type("application/problem+json").send({
        type: "https://example.invalid/problems/not_found",
        title: "Case not found",
        status: 404,
        code: "not_found",
        request_id: request.id,
      });
    }
    throw error;
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/cases/:case_id", {
    schema: {
      params: {
        type: "object",
        required: ["case_id"],
        properties: { case_id: { type: "string", format: "uuid" } },
      },
      response: { 200: CaseProjectionSchema, 404: ProblemDetailsSchema },
    },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const record = await caseQueries.get(caseId);
    const base = `/api/v1/cases/${record.caseId}`;
    return {
      case_id: record.caseId,
      applicant_display_name: record.applicantDisplayName,
      lifecycle: record.lifecycle,
      progress: record.progress,
      result_availability: record.resultAvailability,
      version: record.version,
      links: {
        agent_report: `${base}/agent-report`,
        application_data: `${base}/application-data`,
        documents: `${base}/documents`,
        issues: `${base}/issues`,
        final_review: `${base}/final-review`,
      },
    };
  });

  app.get("/api/v1/cases/:case_id/agent-report", {
    schema: { response: { 200: AgentReportSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const report = await caseQueries.getAgentReport(caseId);
    return {
      availability: report.availability,
      ...(report.summary ? { summary: report.summary } : {}),
      issue_links: [...report.issueLinks],
      checked_facts: report.checkedFacts.map((fact) => ({
        statement: fact.statement,
        status: fact.status,
        references: [...fact.references],
      })),
    };
  });

  app.get("/api/v1/cases/:case_id/issues", {
    schema: { response: { 200: ReviewIssuesSchema, 404: ProblemDetailsSchema } },
  }, async (request) => {
    const { case_id: caseId } = request.params as { case_id: string };
    const issues = await caseQueries.getIssues(caseId);
    return { issues: issues.map((issue) => ({
      issue_id: issue.issueId, origin: issue.origin, code: issue.code,
      description: issue.description, recommended_action: issue.recommendedAction,
      review_state: issue.reviewState, version: issue.version,
    })) };
  });

  app.post(
    "/api/v1/cases",
    {
      schema: {
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: { "idempotency-key": { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["applicant_display_name"],
          additionalProperties: false,
          properties: { applicant_display_name: { type: "string", minLength: 1 } },
        },
        response: { 202: CaseAcceptedSchema, 400: ProblemDetailsSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as { applicant_display_name: string };
      const key = request.headers["idempotency-key"] as string;
      const accepted = await caseCommands.accept({
        applicantDisplayName: body.applicant_display_name,
        idempotencyKey: key,
      });
      const requestId = request.id || randomUUID();
      return reply.code(202).send({
        case_id: accepted.caseId,
        run_id: accepted.runId,
        lifecycle: "processing",
        status_url: `/api/v1/cases/${accepted.caseId}`,
        request_id: requestId,
      });
    },
  );

  return app;
}
