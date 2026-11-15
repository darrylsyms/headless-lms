import type { Actor } from '../shared/actor.js';
import { ForbiddenError, ValidationError } from '../shared/errors.js';

export interface CourseCategoriesRepository {
  list(orgId: string): Promise<string[]>;
  change(orgId: string, name: string, previous?: string): Promise<string[]>;
  delete(orgId: string, name: string): Promise<string[]>;
}

export class CourseCategories {
  constructor(private readonly repo: CourseCategoriesRepository) {}

  list(actor: Actor): Promise<string[]> {
    if (!actor.permissions.anywhere('courses:read')) {
      throw new ForbiddenError('You cannot see course categories');
    }
    return this.repo.list(actor.orgId);
  }

  change(name: string, previous: string | undefined, actor: Actor): Promise<string[]> {
    actor.permissions.require('courses:write');
    name = name.trim();
    if (!name || name.length > 100) {
      throw new ValidationError('Category names must be between 1 and 100 characters');
    }
    if (name.toLowerCase() === 'uncategorised') {
      throw new ValidationError('Uncategorised is reserved');
    }
    return this.repo.change(actor.orgId, name, previous);
  }
  delete(name: string, actor: Actor): Promise<string[]> {
    actor.permissions.require('courses:write');
    return this.repo.delete(actor.orgId, name);
  }
}
