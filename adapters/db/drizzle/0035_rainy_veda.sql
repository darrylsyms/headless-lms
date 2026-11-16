CREATE TABLE "purchase_sync_failures" (
	"org_id" text NOT NULL,
	"org_user_id" text NOT NULL,
	"target" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_sync_failures_org_id_org_user_id_target_pk" PRIMARY KEY("org_id","org_user_id","target")
);
--> statement-breakpoint
ALTER TABLE "purchase_sync_failures" ADD CONSTRAINT "purchase_sync_failures_org_id_org_user_id_org_users_org_id_id_fk" FOREIGN KEY ("org_id","org_user_id") REFERENCES "public"."org_users"("org_id","id") ON DELETE cascade ON UPDATE no action;