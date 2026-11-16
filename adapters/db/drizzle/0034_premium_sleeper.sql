CREATE TABLE "purchase_sync_all_access_bundles" (
	"org_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	CONSTRAINT "purchase_sync_all_access_bundles_org_id_bundle_id_pk" PRIMARY KEY("org_id","bundle_id")
);
--> statement-breakpoint
DROP VIEW "public"."content_access";--> statement-breakpoint
ALTER TABLE "purchase_sync_all_access_bundles" ADD CONSTRAINT "purchase_sync_all_access_bundles_org_id_bundle_id_bundles_org_id_id_fk" FOREIGN KEY ("org_id","bundle_id") REFERENCES "public"."bundles"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE VIEW "public"."content_access" AS (
  select e.org_id, e.org_user_id, e.content_id, e.id as entitlement_id, e.granted_at, e.expires_at
  from entitlements e
  where e.content_id is not null
    and e.status = 'active'
    and (e.expires_at is null or e.expires_at > now())
  union all
  select e.org_id, e.org_user_id, bi.content_id, e.id as entitlement_id, e.granted_at, e.expires_at
  from entitlements e
  join bundle_items bi on bi.org_id = e.org_id and bi.bundle_id = e.bundle_id
  where e.status = 'active'
    and (e.expires_at is null or e.expires_at > now())
    and not exists (select 1 from purchase_sync_all_access_bundles ab where ab.org_id = e.org_id and ab.bundle_id = e.bundle_id)
  union all
  select e.org_id, e.org_user_id, ci.id as content_id, e.id as entitlement_id, e.granted_at, e.expires_at
  from entitlements e
  join purchase_sync_all_access_bundles ab on ab.org_id = e.org_id and ab.bundle_id = e.bundle_id
  join content_items ci on ci.org_id = e.org_id
  where e.status = 'active'
    and (e.expires_at is null or e.expires_at > now())
);