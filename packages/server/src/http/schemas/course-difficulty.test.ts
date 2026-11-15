import { describe, expect, it } from 'vitest';
import { CreateCourse, UpdateCourse } from './content.js';
import { MemberCourses } from './member.js';

describe('course difficulty', () => {
  it('defaults new courses and validates changes', () => {
    expect(CreateCourse.parse({ title: 'Guitar' }).difficulty).toBe('all_levels');
    expect(UpdateCourse.parse({ difficulty: 'expert' }).difficulty).toBe('expert');
    expect(UpdateCourse.safeParse({ difficulty: 'impossible' }).success).toBe(false);
  });

  it('returns difficulty in the member course payload', () => {
    const course = {
      orgId: 'org',
      id: 'course',
      type: 'course',
      title: 'Guitar',
      slug: 'guitar',
      description: '',
      status: 'published',
      category: '',
      difficulty: 'intermediate',
      publishedAt: null,
    scheduledAt: null,
      thumbnailAssetId: null,
      thumbnailUrl: null,
      settings: { transcriptDownloads: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(MemberCourses.parse([course])[0]?.difficulty).toBe('intermediate');
  });
});
