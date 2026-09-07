ALTER TABLE "evidence_records" ADD COLUMN "page_width" integer;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "page_height" integer;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "page_rotation" integer;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "normalized_region" jsonb;