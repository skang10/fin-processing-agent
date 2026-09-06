CREATE TABLE "page_ocr_outputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"engine_version" text NOT NULL,
	"model_asset_version" text NOT NULL,
	"languages" jsonb NOT NULL,
	"coordinate_space" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_ocr_outputs" ADD CONSTRAINT "page_ocr_outputs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_ocr_outputs" ADD CONSTRAINT "page_ocr_outputs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_ocr_output_page_uq" ON "page_ocr_outputs" USING btree ("page_id");