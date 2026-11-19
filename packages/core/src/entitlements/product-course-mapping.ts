import { InvalidInputError, NotFoundError } from '../shared/errors.js';
import type { Actor } from '../shared/actor.js';

export type ProductCourseMapping = { courseId: string; productIds: number[]; primaryProductId?: number | null };
export type ProductCourseMappingStore = {
  get(orgId: string, courseId: string): Promise<ProductCourseMapping | null>;
  replace(orgId: string, mapping: ProductCourseMapping): Promise<void>;
  isCourse(orgId: string, courseId: string): Promise<boolean>;
};

export class ProductCourseMappingService {
  constructor(private readonly store: ProductCourseMappingStore) {}

  async get(courseId: string, actor: Actor): Promise<ProductCourseMapping | null> {
    actor.permissions.require('integrations:read');
    if (!(await this.store.isCourse(actor.orgId, courseId))) {throw new NotFoundError('Course', courseId);}
    return this.store.get(actor.orgId, courseId);
  }

  async replace(mapping: ProductCourseMapping, actor: Actor): Promise<void> {
    actor.permissions.require('integrations:write');
    if (!(await this.store.isCourse(actor.orgId, mapping.courseId))) {throw new NotFoundError('Course', mapping.courseId);}
    if (mapping.productIds.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || new Set(mapping.productIds).size !== mapping.productIds.length) {throw new InvalidInputError('Choose distinct valid products.');}
    if ((mapping.productIds.length > 0 && mapping.primaryProductId == null) || (mapping.primaryProductId != null && !mapping.productIds.includes(mapping.primaryProductId))) {throw new InvalidInputError('Choose a primary product from the selected products.');}
    await this.store.replace(actor.orgId, { courseId: mapping.courseId, productIds: [...mapping.productIds], primaryProductId: mapping.primaryProductId ?? null });
  }
}
