import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { CategoryMapper } from '../../../../../categories/infrastructure/persistence/relational/mappers/category.mapper';
import { Product } from '../../../../domain/product';
import { ProductEntity } from '../entities/product.entity';

export class ProductMapper {
  /** Expects `category` loaded (eager on find, joined in query builders). */
  static toDomain(raw: ProductEntity): Product {
    return Object.assign(new Product(), {
      id: raw.id,
      kitchenId: raw.kitchenId,
      category: CategoryMapper.toDomain(raw.category),
      name: raw.name,
      description: raw.description,
      priceKurus: raw.priceKurus,
      saleType: raw.saleType,
      prepMinutes: raw.prepMinutes,
      portionsAvailable: raw.portionsAvailable,
      allergens: raw.allergens,
      dietTags: raw.dietTags,
      photos: raw.photos.map(toFileType),
      isActive: raw.isActive,
      searchText: raw.searchText,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  /** Writes the category through its id column; the relation stays unset. */
  static toPersistence(domain: Partial<Product>): ProductEntity {
    const { category, photos, ...fields } = domain;

    return Object.assign(
      new ProductEntity(),
      fields,
      category === undefined ? {} : { categoryId: category.id },
      photos === undefined ? {} : { photos: photos.map(toSnapshot) },
    );
  }
}
