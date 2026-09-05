import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CaseAcceptedSchema,
  ProblemDetailsSchema,
} from "@findoc/contracts";
import type { CaseCommandService } from "@findoc/core";

export function buildApp(caseCommands: CaseCommandService) {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook("onRequest", async (request, reply) => {
    const requestId = request.id;
    void reply.header("X-Request-Id", requestId);
  });

  app.get("/health", async () => ({ status: "ok" }));

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
