import { describe, expect, it } from 'vitest';
import { isPublishedWithParent, publishedActivities } from './activity-visibility.js';

describe('topic publication visibility', () => {
  it('includes only published activities and topics of published parents', async () => {
    const rows = [
      { id: 'parent', parentActivityId: null, settings: { published: true } },
      { id: 'topic', parentActivityId: 'parent', settings: { published: true } },
      { id: 'draft-parent', parentActivityId: null, settings: { published: false } },
      { id: 'hidden-topic', parentActivityId: 'draft-parent', settings: { published: true } },
      { id: 'draft-topic', parentActivityId: 'parent', settings: { published: false } },
    ];
    expect(publishedActivities(rows).map(row => row.id)).toEqual(['parent', 'topic']);
    const find = async (id: string) => rows.find(row => row.id === id) ?? null;
    expect(await isPublishedWithParent(rows[1]!, find)).toBe(true);
    expect(await isPublishedWithParent(rows[3]!, find)).toBe(false);
  });
});
