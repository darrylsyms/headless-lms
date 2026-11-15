CREATE TABLE "viewed_activities" (
	"org_id" text NOT NULL,
	"org_user_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viewed_activities_org_id_org_user_id_activity_id_pk" PRIMARY KEY("org_id","org_user_id","activity_id")
);
--> statement-breakpoint
ALTER TABLE "viewed_activities" ADD CONSTRAINT "viewed_activities_org_id_org_user_id_org_users_org_id_id_fk" FOREIGN KEY ("org_id","org_user_id") REFERENCES "public"."org_users"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewed_activities" ADD CONSTRAINT "viewed_activities_org_id_activity_id_activities_org_id_id_fk" FOREIGN KEY ("org_id","activity_id") REFERENCES "public"."activities"("org_id","id") ON DELETE cascade ON UPDATE no action;