import type { Actor } from '../shared/actor.js';
import type { OutboxAppender, UnitOfWork } from '../shared/ports.js';
import { ConflictError } from '../shared/errors.js';
import type { Entitlement } from './model.js';
import { entitlementEvents } from './events.js';

type TargetName = 'course' | 'subscription';
type Managed = Partial<Record<TargetName, { id: string; version: string }>>;
type State = { capturedAt: number; known: Record<TargetName, string[]>; managed?: Managed };
type LedgerKey = { orgId: string; orgUserId: string; integrationId: string };
type GrantKey = { orgUserId: string; contentId?: string; bundleId?: string };
type Scope = {
  ledger: {
    initialize(key: LedgerKey): Promise<void>;
    get(key: LedgerKey): Promise<{ revision: number; state: State | null } | null>;
    replace(key: LedgerKey, revision: number, state: State): Promise<boolean>;
  };
  grants: {
    lockIntegrationGrant(
      orgId: string,
      key: GrantKey,
    ): Promise<{ grant: Entitlement; version: string } | null>;
    insertIntegrationGrant(
      orgId: string,
      input: GrantKey & { source: string },
    ): Promise<Entitlement | null>;
    transitionIntegrationGrantVersion(
      orgId: string,
      input: { id: string; source: string; version: string; status: 'active' | 'revoked' },
    ): Promise<Entitlement | null>;
    contentTypeOf(orgId: string, contentId: string): Promise<string | null>;
  };
  outbox: OutboxAppender;
};

export class PurchaseSyncService {
  constructor(private readonly uow: UnitOfWork<Scope>) {}

  async commit(
    input: {
      orgUserId: string;
      integrationId: string;
      courseId: string;
      bundleId: string;
      expectedRevision: number;
      snapshot: Pick<State, 'capturedAt' | 'known'>;
      decisions: Record<TargetName, 'grant' | 'revoke' | 'hold'>;
    },
    actor: Actor,
  ): Promise<{ held: TargetName[] }> {
    actor.permissions.require('access:write');
    if (
      !input.orgUserId ||
      !input.courseId ||
      !input.bundleId ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.integrationId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      !Number.isSafeInteger(input.snapshot.capturedAt) ||
      input.snapshot.capturedAt <= 0
    )
      {throw new Error('Invalid purchase sync input.');}
    const names: TargetName[] = ['course', 'subscription'];
    for (const name of names) {
      if (
        !['grant', 'revoke', 'hold'].includes(input.decisions[name]) ||
        !Array.isArray(input.snapshot.known[name]) ||
        input.snapshot.known[name].some((id) => typeof id !== 'string' || !id)
      )
        {throw new Error('Invalid purchase sync input.');}
    }
    const key = {
      orgId: actor.orgId,
      orgUserId: input.orgUserId,
      integrationId: input.integrationId,
    };
    const source = `integration:${input.integrationId}`;
    return this.uow.run(async ({ ledger, grants, outbox }) => {
      await ledger.initialize(key);
      const current = await ledger.get(key);
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        (current.state && current.state.capturedAt >= input.snapshot.capturedAt)
      )
        {throw new ConflictError('Purchase sync has changed.');}
      for (const name of names) {
        if (current.state?.known[name].some((id) => !input.snapshot.known[name].includes(id)))
          {throw new ConflictError('Previously observed purchases are missing.');}
      }
      if ((await grants.contentTypeOf(actor.orgId, input.courseId)) !== 'course')
        {throw new Error('The mapped course does not exist.');}
      const managed: Managed = { ...current.state?.managed };
      const held: TargetName[] = [];
      for (const name of names) {
        if (input.decisions[name] === 'hold') {
          held.push(name);
          continue;
        }
        const target: GrantKey =
          name === 'course'
            ? { orgUserId: input.orgUserId, contentId: input.courseId }
            : { orgUserId: input.orgUserId, bundleId: input.bundleId };
        const existing = await grants.lockIntegrationGrant(actor.orgId, target);
        const prior = managed[name];
        if (
          (existing &&
            (!prior ||
              prior.id !== existing.grant.id ||
              prior.version !== existing.version ||
              existing.grant.source !== source)) ||
          (!existing && prior)
        ) {
          held.push(name);
          continue;
        }
        let changed: Entitlement | null = null;
        const wanted = input.decisions[name] === 'grant' ? 'active' : 'revoked';
        if (!existing && wanted === 'active')
          {changed = await grants.insertIntegrationGrant(actor.orgId, { ...target, source });}
        else if (existing && existing.grant.status !== wanted)
          {changed = await grants.transitionIntegrationGrantVersion(actor.orgId, {
            id: existing.grant.id,
            source,
            version: existing.version,
            status: wanted,
          });}
        else {continue;}
        if (!changed) {throw new ConflictError('The access grant changed during synchronization.');}
        const after = await grants.lockIntegrationGrant(actor.orgId, target);
        if (
          !after ||
          after.grant.id !== changed.id ||
          after.grant.source !== source ||
          after.grant.status !== wanted
        )
          {throw new ConflictError('The access grant changed during synchronization.');}
        managed[name] = { id: after.grant.id, version: after.version };
        await outbox.append([
          (wanted === 'active'
            ? entitlementEvents.entitlementCreated
            : entitlementEvents.entitlementDeleted
          ).make({ orgId: actor.orgId, data: changed, metadata: { actorId: actor.id } }),
        ]);
      }
      if (!(await ledger.replace(key, current.revision, { ...input.snapshot, managed })))
        {throw new ConflictError('Purchase sync has changed.');}
      return { held };
    });
  }
}
