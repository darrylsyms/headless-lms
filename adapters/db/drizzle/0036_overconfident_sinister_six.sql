CREATE TABLE "purchase_sync_health" (
	"org_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"state" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_sync_health_org_id_integration_id_pk" PRIMARY KEY("org_id","integration_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_sync_health" ADD CONSTRAINT "purchase_sync_health_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;