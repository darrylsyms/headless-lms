CREATE TABLE "wordpress_identity_snapshots" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wordpress_identity_snapshots_issuer_subject_pk" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
ALTER TABLE "wordpress_identity_snapshots" ADD CONSTRAINT "wordpress_identity_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_identity_snapshots_user_idx" ON "wordpress_identity_snapshots" USING btree ("issuer","user_id");