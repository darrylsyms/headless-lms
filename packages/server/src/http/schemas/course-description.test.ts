import { describe, expect, it } from 'vitest';
import { PatchCourseSettings } from './content.js';
import { MemberCourses } from './member.js';

describe('course body description', () => {
  it('accepts formatted text and clearing it, and rejects oversized descriptions', () => {
    expect(PatchCourseSettings.parse({ bodyDescription: '## What you will learn\n\n- Rhythm' }).bodyDescription).toContain('Rhythm');
    expect(PatchCourseSettings.parse({ bodyDescription: null }).bodyDescription).toBeNull();
    expect(PatchCourseSettings.safeParse({ bodyDescription: 'x'.repeat(20001) }).success).toBe(false);
  });

  it('includes the body description in member course responses', () => {
    const course = { orgId: 'org', id: 'course', type: 'course', title: 'Guitar', slug: 'guitar', description: 'Short introduction', status: 'published', category: '', difficulty: 'all_levels', publishedAt: null, scheduledAt: null, thumbnailAssetId: null, thumbnailUrl: null, settings: { transcriptDownloads: false, bodyDescription: '## More about this course' }, createdAt: new Date(), updatedAt: new Date() };
    const result = MemberCourses.parse([course])[0];
    expect(result?.description).toBe('Short introduction');
    expect(result?.settings.bodyDescription).toBe('## More about this course');
  });
});
