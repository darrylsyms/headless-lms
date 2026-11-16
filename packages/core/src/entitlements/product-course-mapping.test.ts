import { describe, expect, it, vi } from 'vitest';
import { actorWith } from '../organizations/index.js';
import { ProductCourseMappingService } from './product-course-mapping.js';

describe('product course mappings', () => {
  it('saves multiple product ids for an organisation course', async () => {
    const store = { get: vi.fn(), replace: vi.fn(), isCourse: vi.fn().mockResolvedValue(true) };
    const service = new ProductCourseMappingService(store);
    const actor = actorWith({ id: 'admin', orgId: 'org', owner: true });
    await service.replace({ courseId: 'course', productIds: [10, 11] }, actor);
    expect(store.replace).toHaveBeenCalledWith('org', { courseId: 'course', productIds: [10, 11] });
    await expect(service.replace({ courseId: 'course', productIds: [10, 10] }, actor)).rejects.toThrow();
    await service.replace({ courseId: 'course', productIds: [] }, actor);
  });
  it('rejects an unknown course', async () => {
    const store = { get: vi.fn(), replace: vi.fn(), isCourse: vi.fn().mockResolvedValue(false) };
    const service = new ProductCourseMappingService(store);
    await expect(service.replace({ courseId: 'course', productIds: [10] }, actorWith({ id: 'admin', orgId: 'org', owner: true }))).rejects.toThrow('Course not found');
    expect(store.replace).not.toHaveBeenCalled();
  });
});
