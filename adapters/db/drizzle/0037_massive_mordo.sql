ALTER TABLE "activities" DROP CONSTRAINT "activities_org_id_module_id_seq_unique";--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "parent_activity_id" text;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_id_parent_activity_id_activities_org_id_id_fk" FOREIGN KEY ("org_id","parent_activity_id") REFERENCES "public"."activities"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_top_level_seq_uq" ON "activities" USING btree ("org_id","module_id","seq") WHERE "activities"."parent_activity_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_topic_seq_uq" ON "activities" USING btree ("org_id","parent_activity_id","seq") WHERE "activities"."parent_activity_id" is not null;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_no_self_parent" CHECK ("activities"."parent_activity_id" is null or "activities"."parent_activity_id" <> "activities"."id");