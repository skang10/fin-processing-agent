ALTER TABLE "cases" ADD COLUMN "display_number" serial NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "case_display_number_uq" ON "cases" USING btree ("display_number");