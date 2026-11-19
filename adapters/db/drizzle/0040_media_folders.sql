CREATE TABLE "media_folder_assets" (
	"org_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"folder_id" text NOT NULL,
	CONSTRAINT "media_folder_assets_org_id_asset_id_pk" PRIMARY KEY("org_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "media_folders" (
	"org_id" text NOT NULL,
	"id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_folders_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "media_folder_assets" ADD CONSTRAINT "media_folder_assets_org_id_asset_id_assets_org_id_id_fk" FOREIGN KEY ("org_id","asset_id") REFERENCES "public"."assets"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folder_assets" ADD CONSTRAINT "media_folder_assets_org_id_folder_id_media_folders_org_id_id_fk" FOREIGN KEY ("org_id","folder_id") REFERENCES "public"."media_folders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_org_id_parent_id_media_folders_org_id_id_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."media_folders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_folder_assets_folder_idx" ON "media_folder_assets" USING btree ("org_id","folder_id");--> statement-breakpoint
CREATE INDEX "media_folders_parent_idx" ON "media_folders" USING btree ("org_id","parent_id");