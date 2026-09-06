CREATE TABLE "boundary_predictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"starts_new_document" boolean NOT NULL,
	"method" text NOT NULL,
	"version" text NOT NULL,
	"raw_confidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logical_document_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"logical_document_revision_id" uuid NOT NULL,
	"page_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logical_document_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"start_page" integer NOT NULL,
	"end_page" integer NOT NULL,
	"document_type" text NOT NULL,
	"uncertain" boolean NOT NULL,
	"grouping_method" text NOT NULL,
	"grouping_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_classifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"selected_type" text NOT NULL,
	"method" text NOT NULL,
	"version" text NOT NULL,
	"quality_status" text NOT NULL,
	"raw_confidence" jsonb NOT NULL,
	"alternatives" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boundary_predictions" ADD CONSTRAINT "boundary_predictions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_document_pages" ADD CONSTRAINT "logical_document_pages_logical_document_revision_id_logical_document_revisions_id_fk" FOREIGN KEY ("logical_document_revision_id") REFERENCES "public"."logical_document_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_document_pages" ADD CONSTRAINT "logical_document_pages_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_document_revisions" ADD CONSTRAINT "logical_document_revisions_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_document_revisions" ADD CONSTRAINT "logical_document_revisions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_classifications" ADD CONSTRAINT "page_classifications_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boundary_prediction_page_uq" ON "boundary_predictions" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logical_document_page_uq" ON "logical_document_pages" USING btree ("logical_document_revision_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_grouped_page_uq" ON "logical_document_pages" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "logical_document_range_uq" ON "logical_document_revisions" USING btree ("run_id","document_version_id","start_page","end_page");--> statement-breakpoint
CREATE UNIQUE INDEX "page_classification_page_uq" ON "page_classifications" USING btree ("page_id");