CREATE TABLE "final_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"action" text NOT NULL,
	"selected_draft_revision_ids" jsonb NOT NULL,
	"internal_note" text,
	"actor_id" text NOT NULL,
	"command_id" text NOT NULL,
	"resulting_case_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requested_change_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"agent_proposed_text" text,
	"current_text" text NOT NULL,
	"included" boolean NOT NULL,
	"actor_id" text NOT NULL,
	"command_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_issue_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"result_revision_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"actor_id" text NOT NULL,
	"command_id" text NOT NULL,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "final_reviews" ADD CONSTRAINT "final_reviews_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_reviews" ADD CONSTRAINT "final_reviews_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requested_change_revisions" ADD CONSTRAINT "requested_change_revisions_issue_id_review_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."review_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requested_change_revisions" ADD CONSTRAINT "requested_change_revisions_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issue_actions" ADD CONSTRAINT "review_issue_actions_issue_id_review_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."review_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issue_actions" ADD CONSTRAINT "review_issue_actions_result_revision_id_result_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."result_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "final_review_case_uq" ON "final_reviews" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "final_review_command_uq" ON "final_reviews" USING btree ("actor_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requested_change_issue_revision_uq" ON "requested_change_revisions" USING btree ("issue_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "requested_change_command_uq" ON "requested_change_revisions" USING btree ("actor_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_issue_action_command_uq" ON "review_issue_actions" USING btree ("actor_id","command_id");