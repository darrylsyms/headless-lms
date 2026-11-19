import { describe, expect, it, vi } from 'vitest';
import type { MemberActor } from '../identity/index.js';
import { SupportService } from './service.js';

const actor = { orgId: 'org_1', userId: 'usr_1' } as MemberActor;
describe('SupportService', () => {
  it('uses the signed-in account details and organisation for delivery', async () => {
    const account = vi.fn().mockResolvedValue({ username: 'player', firstName: 'Alex', lastName: 'Guitar', email: 'member@example.com' });
    const deliver = vi.fn().mockResolvedValue(undefined);
    await new SupportService(account, deliver).submit('  Help!  ', actor);
    expect(account).toHaveBeenCalledWith('usr_1');
    expect(deliver).toHaveBeenCalledWith('org_1', { message: 'Help!', username: 'player', name: 'Alex Guitar', email: 'member@example.com' });
  });
  it('rejects empty, oversized or unverified account details', async () => {
    const deliver = vi.fn(); const service = new SupportService(async () => null, deliver);
    await expect(service.submit('  ', actor)).rejects.toThrow();
    await expect(service.submit('a'.repeat(5001), actor)).rejects.toThrow();
    await expect(service.submit('Help', actor)).rejects.toThrow();
    expect(deliver).not.toHaveBeenCalled();
  });
});
