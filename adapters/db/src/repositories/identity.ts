// identity — Drizzle repository (implements the core outbound port).
//
// The person only. A person's link to an organization lives in the
// organizations context (`org_users`), not here.
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { IdentityRepository, ProfilePatch } from "@headless-lms/core/identity";
import type {
  CreateUserInput,
  Logger,
  UpdateUserInput,
  User,
  UserProfile,
} from "@headless-lms/core/types";
import { profileDisplayNameChanges, userProfiles, users, wordpressIdentitySnapshots } from "../schema/identity.js";
import { ConflictError } from "@headless-lms/core/shared/errors";
import { noopLogger } from "@headless-lms/core/shared/logger";
import { translateDbErrors } from "./pg-errors.js";

export class DrizzleIdentityRepository implements IdentityRepository {
  constructor(
    private readonly db: NodePgDatabase,
    private readonly logger: Logger = noopLogger,
  ) {}

  async insertUser(input: CreateUserInput): Promise<User> {
    const [row] = await this.db
      .insert(users)
      .values({
        id: input.id,
        externalId: input.externalId ?? null,
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      })
      .returning();
    if (!row) {
      throw new Error("failed to insert user");
    }
    return row;
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<User | null> {
    // An empty patch would be an UPDATE with no SET — read the row back instead.
    if (Object.keys(input).length === 0) {
      return this.findUserById(id);
    }
    const [row] = await this.db.update(users).set(input).where(eq(users.id, id)).returning();
    return row ?? null;
  }

  async findUserById(id: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  async findUserByExternalId(externalId: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    return row ?? null;
  }

  // Case-insensitive: the address comes from whatever an admin typed into an
  // invite, the row from whatever the auth provider stored.
  async findUserByEmail(email: string): Promise<User | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return row ?? null;
  }

  async findProfile(userId: string): Promise<UserProfile | null> {
    const [row] = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async consumeStagingSignoutNonce(userId: string, nonce: string, expiresAt: number): Promise<boolean> {
    if (process.env.NODE_ENV === "production" || process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT !== "1" || !/^[A-Za-z0-9_-]{43}$/.test(nonce) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 60000 || !(await this.findStagingCommerceCustomer(userId))) { return false; }
    const hash = createHash("sha256").update(nonce).digest("hex");
    await this.db.execute(sql`delete from fretwise_staging_signout_nonces where expires_at_ms <= ${Date.now()}`);
    const result = await this.db.execute(sql`insert into fretwise_staging_signout_nonces (nonce_hash, expires_at_ms) values (${hash}, ${expiresAt}) on conflict do nothing returning nonce_hash`);
    return result.rows.length === 1;
  }

  async findStagingCommerceCustomer(userId: string): Promise<number | null> {
    if (process.env.NODE_ENV === "production" || process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC !== "1") { return null; }
    const rows = await this.db.execute(sql`select s.subject from wordpress_identity_snapshots s join users u on u.id = s.user_id join ba_account a on a.user_id = u.external_id and a.account_id = s.subject and a.provider_id = 'fretwise-wordpress-staging' where s.user_id = ${userId} and s.issuer = 'https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc'`);
    if (rows.rows.length !== 1) { return null; }
    const subject = rows.rows[0]?.subject;
    return subject === "23003226" || subject === "23003227" ? Number(subject) : null;
  }

  async findWordPressUsername(userId: string): Promise<string | null> {
    return (await this.findWordPressContact(userId))?.username ?? null;
  }

  async findWordPressContact(userId: string): Promise<{ username: string | null; firstName: string | null; lastName: string | null; email: string | null } | null> {
    const issuer = process.env.FRETWISE_STAGING_WORDPRESS_PROFILE_SYNC === "1"
      ? "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc"
      : null;
    if (!issuer) { return null; }
    const [row] = await this.db.select({ username: wordpressIdentitySnapshots.username, firstName: wordpressIdentitySnapshots.firstName, lastName: wordpressIdentitySnapshots.lastName, email: wordpressIdentitySnapshots.email })
      .from(wordpressIdentitySnapshots)
      .where(and(eq(wordpressIdentitySnapshots.userId, userId), eq(wordpressIdentitySnapshots.issuer, issuer)))
      .limit(1);
    return row ?? null;
  }

  async upsertProfile(userId: string, patch: ProfilePatch): Promise<UserProfile> {
    if (patch.displayName !== undefined && patch.displayNameCooldownSeconds !== undefined) {
      return this.db.transaction(async tx => {
        await tx.execute(sql`select id from users where id = ${userId} for update`);
        const scoped = new DrizzleIdentityRepository(tx as unknown as NodePgDatabase, this.logger);
        const existing = await scoped.findProfile(userId);
        if ((existing?.displayName ?? null) !== patch.displayName) {
          const [changed] = await tx.select().from(profileDisplayNameChanges).where(eq(profileDisplayNameChanges.userId, userId));
          if (changed && Date.now() - changed.changedAt.getTime() < patch.displayNameCooldownSeconds! * 1000) {
            throw new ConflictError("Display names can only be changed once every 30 days.", "DISPLAY_NAME_COOLDOWN");
          }
          await tx.insert(profileDisplayNameChanges).values({ userId, changedAt: new Date() }).onConflictDoUpdate({ target: profileDisplayNameChanges.userId, set: { changedAt: new Date() } });
        }
        const { displayNameCooldownSeconds: _cooldown, ...remaining } = patch;
        return scoped.upsertProfile(userId, remaining);
      });
    }
    const existing = await this.findProfile(userId);
    if (!existing) {
      const [row] = await this.db
        .insert(userProfiles)
        .values({
          userId,
          displayName: patch.displayName ?? null,
          headline: patch.headline ?? null,
          bio: patch.bio ?? null,
          imageAssetOrgId: patch.imageAssetOrgId ?? null,
          imageAssetId: patch.imageAssetId ?? null,
          extra: patch.influences === undefined && patch.sharing === undefined ? patch.extra ?? {} : { ...(patch.influences === undefined ? {} : { influences: patch.influences }), ...(patch.sharing === undefined ? {} : { sharing: patch.sharing }) },
        })
        .returning();
      if (!row) {
        throw new Error("failed to insert profile");
      }
      return row;
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) {
      set.displayName = patch.displayName;
    }
    if (patch.headline !== undefined) {
      set.headline = patch.headline;
    }
    if (patch.bio !== undefined) {
      set.bio = patch.bio;
    }
    if (patch.imageAssetOrgId !== undefined) {
      set.imageAssetOrgId = patch.imageAssetOrgId;
      set.imageAssetId = patch.imageAssetId;
    }
    if (patch.extra !== undefined) {
      set.extra = patch.extra;
    }
    if (patch.influences !== undefined || patch.sharing !== undefined) {
      const fields = { ...(patch.influences === undefined ? {} : { influences: patch.influences }), ...(patch.sharing === undefined ? {} : { sharing: patch.sharing }) };
      set.extra = sql`(case when jsonb_typeof(${userProfiles.extra}) = 'object' then ${userProfiles.extra} else '{}'::jsonb end) || ${JSON.stringify(fields)}::jsonb`;
    }
    const [row] = await this.db
      .update(userProfiles)
      .set(set)
      .where(eq(userProfiles.userId, userId))
      .returning();
    if (!row) {
      throw new Error("failed to update profile");
    }
    return row;
  }
}
translateDbErrors(DrizzleIdentityRepository);
