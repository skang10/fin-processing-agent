CREATE TABLE "recommended_dispositions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"disposition" text NOT NULL,
	"reason_codes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"input_revision_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"revision_type" text NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" text NOT NULL,
	"rule_set_id" text NOT NULL,
	"rule_set_version" text NOT NULL,
	"status" text NOT NULL,
	"reason_code" text NOT NULL,
	"material_input_refs" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommended_dispositions" ADD CONSTRAINT "recommended_dispositions_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_revisions" ADD CONSTRAINT "result_revisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_revisions" ADD CONSTRAINT "result_revisions_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_revisions" ADD CONSTRAINT "result_revisions_input_revision_id_input_revisions_id_fk" FOREIGN KEY ("input_revision_id") REFERENCES "public"."input_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_findings" ADD CONSTRAINT "validation_findings_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disposition_result_uq" ON "recommended_dispositions" USING btree ("result_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "result_revision_run_number_uq" ON "result_revisions" USING btree ("run_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_result_rule_uq" ON "validation_findings" USING btree ("result_revision_id","rule_id");