CREATE TABLE "agent_eligibility_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"gap_ids" jsonb NOT NULL,
	"decision" text NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_gaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"field_schema_id" text NOT NULL,
	"field_schema_version" text NOT NULL,
	"value_type" text NOT NULL,
	"required" boolean NOT NULL,
	"originating_stage" text NOT NULL,
	"reason_code" text NOT NULL,
	"attempted_paths" jsonb NOT NULL,
	"document_version_id" uuid NOT NULL,
	"logical_document_revision_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gap_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gap_id" uuid NOT NULL,
	"resolution_type" text NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "bound_gap_ids" jsonb;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "submitted_candidate_ids" jsonb;--> statement-breakpoint
ALTER TABLE "agent_eligibility_decisions" ADD CONSTRAINT "agent_eligibility_decisions_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_gaps" ADD CONSTRAINT "extraction_gaps_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_gaps" ADD CONSTRAINT "extraction_gaps_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_gaps" ADD CONSTRAINT "extraction_gaps_logical_document_revision_id_logical_document_revisions_id_fk" FOREIGN KEY ("logical_document_revision_id") REFERENCES "public"."logical_document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap_resolutions" ADD CONSTRAINT "gap_resolutions_gap_id_extraction_gaps_id_fk" FOREIGN KEY ("gap_id") REFERENCES "public"."extraction_gaps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_eligibility_run_idx" ON "agent_eligibility_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "extraction_gap_run_idx" ON "extraction_gaps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "gap_resolution_gap_idx" ON "gap_resolutions" USING btree ("gap_id");