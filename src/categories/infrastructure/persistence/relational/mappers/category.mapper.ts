import { Category } from '../../../../domain/category';
import { CategoryEntity } from '../entities/category.entity';

export class CategoryMapper {
  static toDomain(raw: CategoryEntity): Category {
    return Object.assign(new Category(), {
      id: raw.id,
      slug: raw.slug,
      nameTr: raw.nameTr,
      nameEn: raw.nameEn,
      icon: raw.icon,
      sortOrder: raw.sortOrder,
      isActive: raw.isActive,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static toPersistence(domain: Partial<Category>): CategoryEntity {
    return Object.assign(new CategoryEntity(), domain);
  }
}
