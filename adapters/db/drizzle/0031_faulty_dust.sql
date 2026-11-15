CREATE TABLE "purchase_sync_customers" (
	"org_id" text NOT NULL,
	"org_user_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	CONSTRAINT "purchase_sync_customers_org_id_org_user_id_pk" PRIMARY KEY("org_id","org_user_id"),
	CONSTRAINT "purchase_sync_customers_org_id_customer_id_unique" UNIQUE("org_id","customer_id"),
	CONSTRAINT "purchase_sync_customers_org_id_org_user_id_customer_id_unique" UNIQUE("org_id","org_user_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_sync_mappings" (
	"org_id" text NOT NULL,
	"org_user_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"customer_id" integer NOT NULL,
	"course_product_id" integer NOT NULL,
	"subscription_product_ids" jsonb NOT NULL,
	"course_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"manages_subscription" boolean DEFAULT false NOT NULL,
	CONSTRAINT "purchase_sync_mappings_org_id_org_user_id_integration_id_pk" PRIMARY KEY("org_id","org_user_id","integration_id"),
	CONSTRAINT "purchase_sync_mappings_org_id_org_user_id_course_id_unique" UNIQUE("org_id","org_user_id","course_id")
);
--> statement-breakpoint
ALTER TABLE "purchase_sync_customers" ADD CONSTRAINT "purchase_sync_customers_org_id_org_user_id_org_users_org_id_id_fk" FOREIGN KEY ("org_id","org_user_id") REFERENCES "public"."org_users"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_sync_mappings" ADD CONSTRAINT "purchase_sync_mappings_org_id_org_user_id_customer_id_purchase_sync_customers_org_id_org_user_id_customer_id_fk" FOREIGN KEY ("org_id","org_user_id","customer_id") REFERENCES "public"."purchase_sync_customers"("org_id","org_user_id","customer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_sync_mappings" ADD CONSTRAINT "purchase_sync_mappings_org_id_course_id_content_items_org_id_id_fk" FOREIGN KEY ("org_id","course_id") REFERENCES "public"."content_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_sync_mappings" ADD CONSTRAINT "purchase_sync_mappings_org_id_bundle_id_bundles_org_id_id_fk" FOREIGN KEY ("org_id","bundle_id") REFERENCES "public"."bundles"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_sync_mapping_bundle_owner_idx" ON "purchase_sync_mappings" USING btree ("org_id","org_user_id","bundle_id") WHERE "purchase_sync_mappings"."manages_subscription";