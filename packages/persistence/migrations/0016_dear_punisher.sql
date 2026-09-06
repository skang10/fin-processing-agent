ALTER TABLE "pages" ADD COLUMN "render_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "render_width" integer;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "render_height" integer;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "render_dpi" integer;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "renderer_version" text;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_render_artifact_id_artifacts_id_fk" FOREIGN KEY ("render_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;