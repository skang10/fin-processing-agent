CREATE TABLE "agent_session_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"start_reason" text NOT NULL,
	"status" text NOT NULL,
	"terminal_reason" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_tool_invocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_version" text NOT NULL,
	"outcome" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"output_hash" text NOT NULL,
	"safe_output" jsonb,
	"produced_references" jsonb NOT NULL,
	"authorized_input_versions" jsonb NOT NULL,
	"terminates_session" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ALTER COLUMN "terminal_reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ALTER COLUMN "completed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "context_manifest_version" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "model_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "vlm_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "ocr_pages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "cost_micro_usd" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "usage_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "current_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "tool_invocation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "reused_invocation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "integrity_check" text;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD COLUMN "produced_references" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session_attempts" ADD CONSTRAINT "agent_session_attempts_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_invocations" ADD CONSTRAINT "agent_tool_invocations_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_attempt_number_uq" ON "agent_session_attempts" USING btree ("session_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_invocation_key_uq" ON "agent_tool_invocations" USING btree ("session_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_attempt_id_agent_session_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."agent_session_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_tool_invocation_id_agent_tool_invocations_id_fk" FOREIGN KEY ("tool_invocation_id") REFERENCES "public"."agent_tool_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_reused_invocation_id_agent_tool_invocations_id_fk" FOREIGN KEY ("reused_invocation_id") REFERENCES "public"."agent_tool_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_run_mode_uq" ON "agent_sessions" USING btree ("run_id","mode");