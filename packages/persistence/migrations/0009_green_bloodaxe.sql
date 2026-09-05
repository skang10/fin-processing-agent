CREATE TABLE "processing_run_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"prior_status" text,
	"new_status" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_run_transitions" ADD CONSTRAINT "processing_run_transitions_run_id_processing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."processing_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_transition_idx" ON "processing_run_transitions" USING btree ("run_id","created_at");