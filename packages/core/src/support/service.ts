import type { MemberActor } from '../identity/index.js';
import { InvalidInputError, UnavailableError } from '../shared/errors.js';

export type SupportAccount = { username: string | null; firstName: string | null; lastName: string | null; email: string | null };
export type SupportDelivery = (orgId: string, request: { message: string; username: string; name: string; email: string }) => Promise<void>;

export class SupportService {
  constructor(private readonly account: (userId: string) => Promise<SupportAccount | null>, private readonly deliver: SupportDelivery) {}
  async submit(message: string, actor: MemberActor): Promise<void> {
    const body = message.trim();
    if (!body || body.length > 5000) { throw new InvalidInputError('Please enter a message of up to 5,000 characters.'); }
    const account = await this.account(actor.userId);
    if (!account?.username || !account.email) { throw new UnavailableError('Your account details are unavailable. Please sign in again.'); }
    await this.deliver(actor.orgId, { message: body, username: account.username, name: [account.firstName, account.lastName].filter(Boolean).join(' '), email: account.email });
  }
}
