CREATE TABLE "purchase_sync_ledgers" (
	"org_id" text NOT NULL,
	"org_user_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"state" jsonb,
	CONSTRAINT "purchase_sync_ledgers_org_id_org_user_id_integration_id_pk" PRIMARY KEY("org_id","org_user_id","integration_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_sync_ledgers" ADD CONSTRAINT "purchase_sync_ledgers_org_id_org_user_id_org_users_org_id_id_fk" FOREIGN KEY ("org_id","org_user_id") REFERENCES "public"."org_users"("org_id","id") ON DELETE cascade ON UPDATE no action;