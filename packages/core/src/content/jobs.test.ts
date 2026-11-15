import { describe, expect, it, vi } from 'vitest';
import { createCapturingLogger } from '../shared/logger.js';
import {
  contentJobs,
  contentRecurringJobs,
  EVENT_STARTING_SOON_JOB,
  PUBLICATION_JOB,
} from './jobs.js';

function startingSoonJob(logger = createCapturingLogger().logger) {
  const startingSoon = vi.fn(async () => {});
  const job = contentJobs({
    events: { startingSoon },
    publications: { publishDue: vi.fn() },
    logger,
  }).find((entry) => entry.job === EVENT_STARTING_SOON_JOB);
  if (!job) {
    throw new Error('no starting soon job');
  }
  return { startingSoon, job };
}

describe('content jobs', () => {
  it('checks persisted releases on every minute tick', async () => {
    const publishDue = vi.fn(async () => {});
    const job = contentJobs({
      events: { startingSoon: vi.fn() },
      publications: { publishDue },
    }).find((entry) => entry.job === PUBLICATION_JOB);
    expect(contentRecurringJobs).toEqual([{ job: PUBLICATION_JOB, cron: '* * * * *' }]);
    const now = new Date('2026-11-12T12:00:00.000Z');
    await job!.run(null, { id: 'tick', startedAt: now });
    expect(publishDue).toHaveBeenCalledWith(now);
  });

  it('runs the starting-soon notice named in the payload at the firing time', async () => {
    const { startingSoon, job } = startingSoonJob();
    const startedAt = new Date('2026-05-11T16:00:01.000Z');

    await job.run({ orgId: 'org_1', eventId: 'evn_1', lead: '1d' }, { id: 'f', startedAt });

    expect(startingSoon).toHaveBeenCalledWith('org_1', 'evn_1', '1d', startedAt);
  });

  it('logs and drops a payload with an unknown lead', async () => {
    const { logger, entries } = createCapturingLogger();
    const { startingSoon, job } = startingSoonJob(logger);

    await job.run(
      { orgId: 'org_1', eventId: 'evn_1', lead: '2h' },
      { id: 'fire_1', startedAt: new Date() },
    );

    expect(startingSoon).not.toHaveBeenCalled();
    expect(entries).toContainEqual({
      level: 'error',
      msg: 'event starting soon payload refused',
      meta: { job: EVENT_STARTING_SOON_JOB, fireId: 'fire_1' },
    });
  });
});
