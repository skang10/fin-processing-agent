CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"result_revision_id" uuid,
	"mode" text NOT NULL,
	"harness_id" text NOT NULL,
	"harness_version" text NOT NULL,
	"model_label" text NOT NULL,
	"model_route" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"configuration_version" text NOT NULL,
	"tool_registry_version" text NOT NULL,
	"offered_tools" jsonb NOT NULL,
	"budget" jsonb NOT NULL,
	"iterations" integer NOT NULL,
	"tool_calls" integer NOT NULL,
	"usage" jsonb NOT NULL,
	"estimated_cost" text,
	"terminal_reason" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"tool_name" text NOT NULL,
	"tool_version" text,
	"argument_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"summary" text NOT NULL,
	"budget_state" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reports" ALTER COLUMN "estimated_cost" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD COLUMN "original_submission" jsonb;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_session_run_idx" ON "agent_sessions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_session_case_idx" ON "agent_sessions" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_step_sequence_uq" ON "agent_steps" USING btree ("session_id","sequence");--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;