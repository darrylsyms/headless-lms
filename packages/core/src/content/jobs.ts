import { z } from 'zod';
import { eventLeadSchema, idSchema } from '../types/schemas/index.js';
import type { EventLead } from '../types/index.js';
import type { Logger, RecurringJob, ScheduledJob } from '../shared/ports.js';
import { noopLogger } from '../shared/logger.js';
import type { EventsService } from './ports.js';

export const PUBLICATION_JOB = 'content.publication.due';
export const contentRecurringJobs: RecurringJob[] = [{ job: PUBLICATION_JOB, cron: '* * * * *' }];

export const EVENT_STARTING_SOON_JOB = 'content.events.starting_soon';

export const EVENT_LEADS: Readonly<Record<EventLead, number>> = {
  '1d': 24 * 60 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

const startingSoonPayload = z
  .object({ orgId: idSchema, eventId: idSchema, lead: eventLeadSchema })
  .strict();

export interface ContentJobDeps {
  events: Pick<EventsService, 'startingSoon'>;
  publications: { publishDue(now: Date): Promise<void> };
  logger?: Logger;
}

export function contentJobs(deps: ContentJobDeps): ScheduledJob[] {
  const logger = deps.logger ?? noopLogger;
  return [
    {
      job: PUBLICATION_JOB,
      async run(_payload, fire) {
        await deps.publications.publishDue(fire.startedAt);
      },
    },
    {
      job: EVENT_STARTING_SOON_JOB,
      async run(payload, fire) {
        const parsed = startingSoonPayload.safeParse(payload);
        if (!parsed.success) {
          logger.error('event starting soon payload refused', {
            job: EVENT_STARTING_SOON_JOB,
            fireId: fire.id,
          });
          return;
        }
        const { orgId, eventId, lead } = parsed.data;
        await deps.events.startingSoon(orgId, eventId, lead, fire.startedAt);
      },
    },
  ];
}
