CREATE TABLE "document_inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"processor" text NOT NULL,
	"processor_version" text NOT NULL,
	"pdf_type" text NOT NULL,
	"routing_signal" text NOT NULL,
	"is_complex" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_inspection_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"needs_ocr" boolean NOT NULL,
	"ocr_reason" text,
	"has_table" boolean NOT NULL,
	"has_columns" boolean NOT NULL,
	"native_character_count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_inspections" ADD CONSTRAINT "document_inspections_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_inspections" ADD CONSTRAINT "document_inspections_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_inspection_id_document_inspections_id_fk" FOREIGN KEY ("document_inspection_id") REFERENCES "public"."document_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_run_document_uq" ON "document_inspections" USING btree ("run_id","document_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_inspection_number_uq" ON "pages" USING btree ("document_inspection_id","page_number");