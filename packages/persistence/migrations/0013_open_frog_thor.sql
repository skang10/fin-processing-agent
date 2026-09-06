CREATE TABLE "review_issue_edit_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"description" text NOT NULL,
	"recommended_action" text NOT NULL,
	"supporting_references" jsonb NOT NULL,
	"no_reference_reason" text,
	"actor_id" text NOT NULL,
	"command_id" text NOT NULL,
	"resulting_issue_version" integer NOT NULL,
	"resulting_case_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_issue_edit_revisions" ADD CONSTRAINT "review_issue_edit_revisions_issue_id_review_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."review_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issue_edit_revisions" ADD CONSTRAINT "review_issue_edit_revisions_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_issue_edit_revision_uq" ON "review_issue_edit_revisions" USING btree ("issue_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "review_issue_edit_command_uq" ON "review_issue_edit_revisions" USING btree ("actor_id","command_id");