import { NullableType } from '../../../utils/types/nullable.type';
import { Category } from '../../domain/category';

export abstract class CategoryRepository {
  abstract create(
    data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Category>;

  /** Active ones, by sortOrder then Turkish name. */
  abstract findActive(): Promise<Category[]>;

  abstract findById(id: Category['id']): Promise<NullableType<Category>>;

  abstract findBySlug(slug: Category['slug']): Promise<NullableType<Category>>;

  abstract update(
    id: Category['id'],
    payload: Partial<Category>,
  ): Promise<Category>;
}
