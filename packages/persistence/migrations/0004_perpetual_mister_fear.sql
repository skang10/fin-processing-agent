CREATE TABLE "application_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"schema_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid,
	"prior_state" text,
	"new_state" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_document_selections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"input_revision_id" uuid NOT NULL,
	"physical_document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"application_snapshot_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "input_revision_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "application_snapshots" ADD CONSTRAINT "application_snapshots_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_state_transitions" ADD CONSTRAINT "case_state_transitions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_document_selections" ADD CONSTRAINT "input_document_selections_input_revision_id_input_revisions_id_fk" FOREIGN KEY ("input_revision_id") REFERENCES "public"."input_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_document_selections" ADD CONSTRAINT "input_document_selections_physical_document_id_physical_documents_id_fk" FOREIGN KEY ("physical_document_id") REFERENCES "public"."physical_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_document_selections" ADD CONSTRAINT "input_document_selections_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_revisions" ADD CONSTRAINT "input_revisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_revisions" ADD CONSTRAINT "input_revisions_application_snapshot_id_application_snapshots_id_fk" FOREIGN KEY ("application_snapshot_id") REFERENCES "public"."application_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_snapshot_case_idx" ON "application_snapshots" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_transition_case_idx" ON "case_state_transitions" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "input_selection_revision_document_uq" ON "input_document_selections" USING btree ("input_revision_id","physical_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "input_revision_case_number_uq" ON "input_revisions" USING btree ("case_id","revision");--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_input_revision_id_input_revisions_id_fk" FOREIGN KEY ("input_revision_id") REFERENCES "public"."input_revisions"("id") ON DELETE no action ON UPDATE no action;