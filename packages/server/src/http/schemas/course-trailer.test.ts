import { describe, expect, it } from 'vitest';
import { PatchCourseSettings } from './content.js';
import { MemberCourses } from './member.js';

describe('course trailer setting', () => {
  it('accepts HTTPS trailer URLs and clearing the value, but rejects unsafe URLs', () => {
    expect(PatchCourseSettings.parse({ trailerUrl: 'https://vimeo.com/123456' }).trailerUrl).toBe('https://vimeo.com/123456');
    expect(PatchCourseSettings.parse({ trailerUrl: null }).trailerUrl).toBeNull();
    expect(PatchCourseSettings.safeParse({ trailerUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(PatchCourseSettings.safeParse({ trailerUrl: 'http://example.com/video.mp4' }).success).toBe(false);
  });

  it('includes the trailer URL in member course responses', () => {
    const course = { orgId: 'org', id: 'course', type: 'course', title: 'Guitar', slug: 'guitar', description: '', status: 'published', category: '', difficulty: 'all_levels', publishedAt: null, scheduledAt: null, thumbnailAssetId: null, thumbnailUrl: null, settings: { transcriptDownloads: false, trailerUrl: 'https://vimeo.com/123456' }, createdAt: new Date(), updatedAt: new Date() };
    expect(MemberCourses.parse([course])[0]?.settings.trailerUrl).toBe('https://vimeo.com/123456');
  });
});
