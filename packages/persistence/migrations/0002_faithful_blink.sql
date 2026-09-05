CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"detected_media_type" text NOT NULL,
	"artifact_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"physical_document_id" uuid NOT NULL,
	"source_artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"submitted_filename" text NOT NULL,
	"detected_media_type" text NOT NULL,
	"integrity_state" text NOT NULL,
	"readability_state" text NOT NULL,
	"malware_scan_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_physical_document_id_physical_documents_id_fk" FOREIGN KEY ("physical_document_id") REFERENCES "public"."physical_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_source_artifact_id_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_documents" ADD CONSTRAINT "physical_documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_object_key_uq" ON "artifacts" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "artifact_case_idx" ON "artifacts" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_number_uq" ON "document_versions" USING btree ("physical_document_id","version");--> statement-breakpoint
CREATE INDEX "physical_document_case_idx" ON "physical_documents" USING btree ("case_id");