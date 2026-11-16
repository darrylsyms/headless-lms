// integrations tables — an org's connections to external services. One
// connection per integration per org; the secret itself lives in the
// credentials table (secure credential store), referenced by credential_ref.
import {
  pgTable,
  text,
  boolean,
  jsonb,
  integer,
  timestamp,
  primaryKey,
  foreignKey,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Connection } from "@headless-lms/core/schemas";
import { organizations, orgUsers } from "./organizations.js";
import { credentials } from "./credentials.js";
import { bundles, contentItems } from "./content.js";
import type { Expect, NoDrift } from "./drift.js";

export const connections = pgTable(
  "connections",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    id: text("id").notNull(),
    integrationId: text("integration_id").notNull(),
    config: jsonb("config").$type<Connection["config"]>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    credentialRef: text("credential_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    onePerIntegration: unique().on(t.orgId, t.integrationId),
    credentialFk: foreignKey({
      columns: [t.orgId, t.credentialRef],
      foreignColumns: [credentials.orgId, credentials.id],
    }),
  }),
);

type _ConnectionsDrift = Expect<NoDrift<typeof connections.$inferSelect, Connection>>;

export const purchaseSyncLedgers = pgTable(
  "purchase_sync_ledgers",
  {
    orgId: text("org_id").notNull(),
    orgUserId: text("org_user_id").notNull(),
    integrationId: text("integration_id").notNull(),
    revision: integer("revision").notNull().default(0),
    state: jsonb("state").$type<{
      capturedAt: number;
      known: { course: string[]; subscription: string[] };
      managed?: Partial<Record<"course" | "subscription", { id: string; version: string }>>;
    } | null>(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.orgUserId, t.integrationId] }),
    orgUserFk: foreignKey({
      columns: [t.orgId, t.orgUserId],
      foreignColumns: [orgUsers.orgId, orgUsers.id],
    }).onDelete("cascade"),
  }),
);

export const purchaseSyncCustomers = pgTable(
  "purchase_sync_customers",
  {
    orgId: text("org_id").notNull(),
    orgUserId: text("org_user_id").notNull(),
    customerId: integer("customer_id").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.orgUserId] }),
    customerOnce: unique().on(t.orgId, t.customerId),
    identity: unique().on(t.orgId, t.orgUserId, t.customerId),
    userFk: foreignKey({
      columns: [t.orgId, t.orgUserId],
      foreignColumns: [orgUsers.orgId, orgUsers.id],
    }).onDelete("cascade"),
  }),
);

export const purchaseSyncFailures = pgTable(
  "purchase_sync_failures",
  {
    orgId: text("org_id").notNull(),
    orgUserId: text("org_user_id").notNull(),
    target: text("target").notNull(),
    attempts: integer("attempts").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }).notNull().defaultNow(),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.orgUserId, t.target] }),
    userFk: foreignKey({ columns: [t.orgId, t.orgUserId], foreignColumns: [orgUsers.orgId, orgUsers.id] }).onDelete("cascade"),
  }),
);

export const purchaseSyncHealth = pgTable(
  "purchase_sync_health",
  {
    orgId: text("org_id").notNull().references(() => organizations.id),
    integrationId: text("integration_id").notNull(),
    state: text("state", { enum: ["ok", "error"] }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.integrationId] }) }),
);

export const purchaseSyncMappings = pgTable(
  "purchase_sync_mappings",
  {
    orgId: text("org_id").notNull(),
    orgUserId: text("org_user_id").notNull(),
    integrationId: text("integration_id").notNull(),
    customerId: integer("customer_id").notNull(),
    courseProductId: integer("course_product_id").notNull(),
    subscriptionProductIds: jsonb("subscription_product_ids").$type<number[]>().notNull(),
    courseId: text("course_id").notNull(),
    bundleId: text("bundle_id").notNull(),
    managesSubscription: boolean("manages_subscription").notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.orgUserId, t.integrationId] }),
    customerFk: foreignKey({
      columns: [t.orgId, t.orgUserId, t.customerId],
      foreignColumns: [
        purchaseSyncCustomers.orgId,
        purchaseSyncCustomers.orgUserId,
        purchaseSyncCustomers.customerId,
      ],
    }).onDelete("cascade"),
    courseFk: foreignKey({
      columns: [t.orgId, t.courseId],
      foreignColumns: [contentItems.orgId, contentItems.id],
    }),
    bundleFk: foreignKey({
      columns: [t.orgId, t.bundleId],
      foreignColumns: [bundles.orgId, bundles.id],
    }),
    courseOnce: unique().on(t.orgId, t.orgUserId, t.courseId),
    bundleOnce: uniqueIndex("purchase_sync_mapping_bundle_owner_idx")
      .on(t.orgId, t.orgUserId, t.bundleId)
      .where(sql`${t.managesSubscription}`),
  }),
);

export const purchaseSyncWebhookJobs = pgTable(
  "purchase_sync_webhook_jobs",
  {
    orgId: text("org_id").notNull().references(() => organizations.id),
    deliveryId: text("delivery_id").notNull(),
    topic: text("topic").notNull(),
    resourceId: integer("resource_id").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseId: text("lease_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.deliveryId] }),
    dueIdx: index("purchase_sync_webhook_due_idx").on(t.orgId, t.state, t.nextAttemptAt),
  }),
);
