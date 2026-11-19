import { Mailer } from '@headless-lms/core/shared/mailer';
import { UnavailableError } from '@headless-lms/core/shared/errors';
import type { EmailSender, TemplateContext, TemplateRenderer } from '@headless-lms/core/shared/ports';
import type { Integration, Connection } from '@headless-lms/core/types';

export interface OrganizationEmailDependencies {
  orgId: string;
  useSink: boolean;
  fallback: Mailer;
  fallbackSender: EmailSender;
  templates: TemplateRenderer;
  context: TemplateContext;
  connection: (orgId: string) => Promise<Connection | null>;
  integration: () => Integration | null;
  secrets: (orgId: string, credentialRef: string) => Promise<Record<string, unknown> | null>;
}

export async function organizationEmailSender(deps: OrganizationEmailDependencies): Promise<EmailSender> {
  if (deps.useSink) { return deps.fallbackSender; }
  const connection = await deps.connection(deps.orgId);
  if (!connection) { return deps.fallbackSender; }
  if (connection.orgId !== deps.orgId) { throw new UnavailableError('The organisation email connection is unavailable.'); }
  if (!connection.active) { throw new UnavailableError('The organisation email connection is inactive.'); }
  const action = deps.integration()?.actions.find(item => item.id === 'sendNotificationEmail');
  const secrets = await deps.secrets(deps.orgId, connection.credentialRef);
  if (!action || !secrets) { throw new UnavailableError('The organisation email connection is unavailable.'); }
  return { send: async message => { await action.invoke({ config: connection.config, secrets }, message); } };
}

export async function organizationNotificationMailer(deps: OrganizationEmailDependencies): Promise<Mailer> {
  if (deps.useSink) { return deps.fallback; }
  const sender = await organizationEmailSender(deps);
  return sender === deps.fallbackSender ? deps.fallback : new Mailer(deps.templates, sender, deps.context);
}

export async function singleOrganizationEmailSender(deps: {
  useSink: boolean;
  fallback: EmailSender;
  organizationIds: () => Promise<string[]>;
  forOrganization: (orgId: string) => Promise<EmailSender>;
}): Promise<EmailSender> {
  if (deps.useSink) { return deps.fallback; }
  const ids = await deps.organizationIds();
  if (ids.length === 0) { return deps.fallback; }
  if (ids.length !== 1) { throw new UnavailableError('A default email sender cannot be selected because multiple organisations exist.'); }
  return deps.forOrganization(ids[0]!);
}
