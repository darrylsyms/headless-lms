import { describe, expect, it, vi } from 'vitest';
import { Mailer } from '@headless-lms/core/shared/mailer';
import type { TemplateRenderer, TemplateContext } from '@headless-lms/core/shared/ports';
import type { Connection, Integration } from '@headless-lms/core/types';
import { organizationEmailSender, organizationNotificationMailer, singleOrganizationEmailSender } from './organization-email.js';

const context: TemplateContext = { brandName: 'Fretwise', baseUrl: 'https://example.com', studentPortalUrl: 'https://example.com' };
const templates = { render: vi.fn().mockResolvedValue({ subject: 'Reply', text: 'Hello', html: '<p>Hello</p>' }) } as unknown as TemplateRenderer;
const invoke = vi.fn().mockResolvedValue({ accepted: true });
const integration = { actions: [{ id: 'sendNotificationEmail', invoke }] } as unknown as Integration;
const config = { region: 'eu-west-1', from: 'sender@example.com', supportEmail: 'help@example.com' };
const connection: Connection = { id: 'cn_1', orgId: 'org_1', integrationId: 'amazon-ses', active: true, credentialRef: 'cred_1', config, createdAt: new Date(), updatedAt: new Date() };
const fallbackSend = vi.fn().mockResolvedValue(undefined);
const fallbackSender = { send: fallbackSend };
const fallback = new Mailer(templates, fallbackSender, context);
function deps() { return { orgId: 'org_1', useSink: false, fallback, fallbackSender, templates, context, connection: vi.fn().mockResolvedValue(connection), integration: () => integration, secrets: vi.fn().mockResolvedValue({ accessKeyId: 'key', secretAccessKey: 'secret' }) }; }

describe('organisation notification email', () => {
  it('uses the organisation connection and scoped credentials', async () => {
    const input = deps(); const mailer = await organizationNotificationMailer(input);
    await mailer.send('member@example.com', 'passwordChanged', {});
    expect(input.connection).toHaveBeenCalledWith('org_1');
    expect(input.secrets).toHaveBeenCalledWith('org_1', 'cred_1');
    expect(invoke).toHaveBeenCalledWith({ config, secrets: { accessKeyId: 'key', secretAccessKey: 'secret' } }, { to: 'member@example.com', subject: 'Reply', text: 'Hello', html: '<p>Hello</p>' });
  });
  it('keeps the local sink and avoids reading SES secrets', async () => {
    const input = { ...deps(), useSink: true }; expect(await organizationNotificationMailer(input)).toBe(fallback);
    expect(input.connection).not.toHaveBeenCalled(); expect(input.secrets).not.toHaveBeenCalled();
  });
  it('uses the existing transport when no connection exists', async () => {
    const input = { ...deps(), connection: vi.fn().mockResolvedValue(null) };
    expect(await organizationNotificationMailer(input)).toBe(fallback);
  });
  it('does not fall back if the connection is inactive or credentials are missing', async () => {
    await expect(organizationNotificationMailer({ ...deps(), connection: vi.fn().mockResolvedValue({ ...connection, active: false }) })).rejects.toThrow(/inactive/);
    await expect(organizationNotificationMailer({ ...deps(), secrets: vi.fn().mockResolvedValue(null) })).rejects.toThrow(/unavailable/);
  });
  it('rejects a connection belonging to another organisation', async () => {
    const input = { ...deps(), connection: vi.fn().mockResolvedValue({ ...connection, orgId: 'org_other' }) };
    await expect(organizationNotificationMailer(input)).rejects.toThrow(/unavailable/);
    expect(input.secrets).not.toHaveBeenCalled();
  });
});

describe('single organisation system email', () => {
  it('routes a password reset through the configured SES connection', async () => {
    const input = deps();
    const sender = await singleOrganizationEmailSender({ useSink: false, fallback: fallbackSender, organizationIds: async () => ['org_1'], forOrganization: orgId => organizationEmailSender({ ...input, orgId }) });
    await new Mailer(templates, sender, context).send('member@example.com', 'passwordReset', { resetUrl: 'https://example.com/reset' });
    expect(invoke).toHaveBeenLastCalledWith({ config, secrets: { accessKeyId: 'key', secretAccessKey: 'secret' } }, { to: 'member@example.com', subject: 'Reply', text: 'Hello', html: '<p>Hello</p>' });
  });
  it('uses the only organisation without requiring a signed-in member', async () => {
    const select = vi.fn().mockResolvedValue({ send: vi.fn() });
    await singleOrganizationEmailSender({ useSink: false, fallback: fallbackSender, organizationIds: async () => ['org_1'], forOrganization: select });
    expect(select).toHaveBeenCalledWith('org_1');
  });
  it('does not guess when multiple organisations exist', async () => {
    const select = vi.fn();
    await expect(singleOrganizationEmailSender({ useSink: false, fallback: fallbackSender, organizationIds: async () => ['org_1', 'org_2'], forOrganization: select })).rejects.toThrow(/multiple organisations/);
    expect(select).not.toHaveBeenCalled();
  });
  it('preserves the local sink and bootstrap fallback', async () => {
    const ids = vi.fn().mockResolvedValue([]); const select = vi.fn();
    expect(await singleOrganizationEmailSender({ useSink: true, fallback: fallbackSender, organizationIds: ids, forOrganization: select })).toBe(fallbackSender);
    expect(ids).not.toHaveBeenCalled();
    expect(await singleOrganizationEmailSender({ useSink: false, fallback: fallbackSender, organizationIds: ids, forOrganization: select })).toBe(fallbackSender);
  });
});
