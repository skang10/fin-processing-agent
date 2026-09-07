ALTER TABLE "evidence_records" ADD COLUMN "original_region" jsonb;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "coordinate_unit" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "coordinate_origin" text;