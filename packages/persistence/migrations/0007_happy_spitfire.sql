CREATE TABLE "claim_evidence_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"claim_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"relationship" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"field_schema_id" text NOT NULL,
	"value_type" text NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" jsonb NOT NULL,
	"normalization_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"application_snapshot_id" uuid,
	"json_pointer" text,
	"document_version_id" uuid,
	"page_number" integer,
	"extraction_method" text NOT NULL,
	"processor_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_claim_id_claim_records_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_records" ADD CONSTRAINT "claim_records_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_application_snapshot_id_application_snapshots_id_fk" FOREIGN KEY ("application_snapshot_id") REFERENCES "public"."application_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_evidence_uq" ON "claim_evidence_links" USING btree ("claim_id","evidence_id");--> statement-breakpoint
CREATE INDEX "claim_run_idx" ON "claim_records" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "evidence_run_idx" ON "evidence_records" USING btree ("run_id");