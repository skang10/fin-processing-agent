import { Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const CaseLifecycleSchema = Type.Union([
  Type.Literal("processing"),
  Type.Literal("ready_for_review"),
  Type.Literal("review_complete"),
  Type.Literal("processing_exception"),
]);

export const CaseAcceptedSchema = Type.Object({
  case_id: Type.String({ minLength: 1 }),
  run_id: Type.String({ minLength: 1 }),
  lifecycle: CaseLifecycleSchema,
  status_url: Type.String({ minLength: 1 }),
  request_id: Type.String({ minLength: 1 }),
});

export const CaseProjectionSchema = Type.Object({
  case_id: Type.String({ minLength: 1 }),
  applicant_display_name: Type.String({ minLength: 1 }),
  lifecycle: CaseLifecycleSchema,
  progress: Type.Union([
    Type.Literal("submitted"),
    Type.Literal("extracted"),
    Type.Literal("agent_checked"),
    Type.Literal("human_review"),
    Type.Literal("outcome"),
  ]),
  result_availability: Type.Union([
    Type.Literal("pending"),
    Type.Literal("ready"),
    Type.Literal("unavailable"),
  ]),
  version: Type.Integer({ minimum: 1 }),
});

export const ProblemDetailsSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  code: Type.String(),
  request_id: Type.String(),
  detail: Type.Optional(Type.String()),
});

export type CaseAccepted = Static<typeof CaseAcceptedSchema>;
export type CaseProjection = Static<typeof CaseProjectionSchema>;

export const CaseProcessingJobSchema = Type.Object({
  case_id: Type.String({ format: "uuid" }),
  run_id: Type.String({ format: "uuid" }),
}, { additionalProperties: false });

export type CaseProcessingJob = Static<typeof CaseProcessingJobSchema>;

export function isCaseProcessingJob(value: unknown): value is CaseProcessingJob {
  return Value.Check(CaseProcessingJobSchema, value);
}
