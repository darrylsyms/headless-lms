CREATE TABLE "comment_requests" (
	"org_id" text NOT NULL,
	"org_user_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"activity_id" text NOT NULL,
	"parent_id" text,
	"body_hash" text NOT NULL,
	"comment_id" text NOT NULL,
	CONSTRAINT "comment_requests_org_id_org_user_id_client_id_pk" PRIMARY KEY("org_id","org_user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "comment_requests" ADD CONSTRAINT "comment_requests_org_id_org_user_id_org_users_org_id_id_fk" FOREIGN KEY ("org_id","org_user_id") REFERENCES "public"."org_users"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_requests" ADD CONSTRAINT "comment_requests_org_id_activity_id_activities_org_id_id_fk" FOREIGN KEY ("org_id","activity_id") REFERENCES "public"."activities"("org_id","id") ON DELETE cascade ON UPDATE no action;