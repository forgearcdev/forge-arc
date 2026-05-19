CREATE TYPE "public"."job_status" AS ENUM('Funded', 'Submitted', 'Completed', 'Rejected', 'Expired');--> statement-breakpoint
CREATE TABLE "agents" (
	"agent_id" bigint PRIMARY KEY NOT NULL,
	"current_owner" text NOT NULL,
	"registered_block" bigint NOT NULL,
	"registered_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"job_id" bigint PRIMARY KEY NOT NULL,
	"agent_id" bigint NOT NULL,
	"client" text NOT NULL,
	"bounty_micro" bigint NOT NULL,
	"deadline" bigint NOT NULL,
	"status" "job_status" NOT NULL,
	"deliverable_uri" text,
	"reject_reason" text,
	"created_at" bigint NOT NULL,
	"created_block" bigint NOT NULL,
	"created_tx_hash" text NOT NULL,
	"completed_at" bigint,
	"completed_tx_hash" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" bigint NOT NULL,
	"agent_id" bigint NOT NULL,
	"recipient" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("job_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_current_owner" ON "agents" USING btree ("current_owner");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_agent_id" ON "jobs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_client" ON "jobs" USING btree ("client");--> statement-breakpoint
CREATE INDEX "idx_jobs_created_at" ON "jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_payments_agent_id" ON "payments" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_payments_timestamp" ON "payments" USING btree ("timestamp");