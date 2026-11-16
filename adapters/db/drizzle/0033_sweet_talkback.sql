CREATE TABLE "purchase_sync_webhook_jobs" (
	"org_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"topic" text NOT NULL,
	"resource_id" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "purchase_sync_webhook_jobs_org_id_delivery_id_pk" PRIMARY KEY("org_id","delivery_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_sync_webhook_jobs" ADD CONSTRAINT "purchase_sync_webhook_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_sync_webhook_due_idx" ON "purchase_sync_webhook_jobs" USING btree ("org_id","state","next_attempt_at");