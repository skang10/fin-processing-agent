CREATE TABLE "candidate_evidence_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"relationship" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_candidate_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"relationship" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"field_schema_id" text NOT NULL,
	"field_schema_version" text NOT NULL,
	"value_type" text NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" jsonb NOT NULL,
	"extraction_method" text NOT NULL,
	"processor_version" text NOT NULL,
	"quality_status" text NOT NULL,
	"application_snapshot_id" uuid,
	"json_pointer" text,
	"logical_document_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_source_ck" CHECK ((
    "extraction_candidates"."application_snapshot_id" is not null and "extraction_candidates"."json_pointer" is not null and "extraction_candidates"."logical_document_revision_id" is null
  ) or (
    "extraction_candidates"."application_snapshot_id" is null and "extraction_candidates"."json_pointer" is null and "extraction_candidates"."logical_document_revision_id" is not null
  ))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_candidate_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"field_schema_id" text NOT NULL,
	"method" text NOT NULL,
	"method_version" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"selected_candidate_id" uuid,
	"resulting_claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_evidence_links" ADD CONSTRAINT "candidate_evidence_links_candidate_id_extraction_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."extraction_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_evidence_links" ADD CONSTRAINT "candidate_evidence_links_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_candidate_links" ADD CONSTRAINT "claim_candidate_links_claim_id_claim_records_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_candidate_links" ADD CONSTRAINT "claim_candidate_links_candidate_id_extraction_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."extraction_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_application_snapshot_id_application_snapshots_id_fk" FOREIGN KEY ("application_snapshot_id") REFERENCES "public"."application_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_logical_document_revision_id_logical_document_revisions_id_fk" FOREIGN KEY ("logical_document_revision_id") REFERENCES "public"."logical_document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_candidate_links" ADD CONSTRAINT "reconciliation_candidate_links_reconciliation_id_reconciliation_decisions_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliation_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_candidate_links" ADD CONSTRAINT "reconciliation_candidate_links_candidate_id_extraction_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."extraction_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_decisions" ADD CONSTRAINT "reconciliation_decisions_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_decisions" ADD CONSTRAINT "reconciliation_decisions_selected_candidate_id_extraction_candidates_id_fk" FOREIGN KEY ("selected_candidate_id") REFERENCES "public"."extraction_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_decisions" ADD CONSTRAINT "reconciliation_decisions_resulting_claim_id_claim_records_id_fk" FOREIGN KEY ("resulting_claim_id") REFERENCES "public"."claim_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_evidence_uq" ON "candidate_evidence_links" USING btree ("candidate_id","evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_candidate_uq" ON "claim_candidate_links" USING btree ("claim_id","candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_run_idx" ON "extraction_candidates" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_candidate_uq" ON "reconciliation_candidate_links" USING btree ("reconciliation_id","candidate_id");--> statement-breakpoint
CREATE INDEX "reconciliation_run_idx" ON "reconciliation_decisions" USING btree ("run_id");