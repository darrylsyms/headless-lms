import { describe, expect, it } from 'vitest';
import { courseSettingsDefaults } from '@headless-lms/core/schemas';
import { PatchCourseSettings } from './content.js';
import { MemberCourses } from './member.js';

describe('song library setting', () => {
  it('defaults existing courses to the course library and accepts boolean changes', () => {
    expect(courseSettingsDefaults.songLibrary).toBe(false);
    expect(PatchCourseSettings.parse({ songLibrary: true })).toEqual({ songLibrary: true });
    expect(PatchCourseSettings.safeParse({ songLibrary: 'yes' }).success).toBe(false);
  });

  it('includes the setting in member course responses', () => {
    const course = {
      orgId: 'org', id: 'course', type: 'course', title: 'Guitar', slug: 'guitar',
      description: '', status: 'published', category: '', difficulty: 'all_levels',
      publishedAt: null, scheduledAt: null, thumbnailAssetId: null, thumbnailUrl: null,
      settings: { transcriptDownloads: false, songLibrary: true },
      createdAt: new Date(), updatedAt: new Date(),
    };
    expect(MemberCourses.parse([course])[0]?.settings.songLibrary).toBe(true);
  });
});
