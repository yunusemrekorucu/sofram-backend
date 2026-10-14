import { Kitchen } from '../../../kitchens/domain/kitchen';
import { NullableType } from '../../../utils/types/nullable.type';
import { Product } from '../../domain/product';

export abstract class ProductRepository {
  abstract create(
    data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Product>;

  /** Newest first. */
  abstract findByKitchenId(kitchenId: Kitchen['id']): Promise<Product[]>;

  abstract findOwned(
    kitchenId: Kitchen['id'],
    id: Product['id'],
  ): Promise<NullableType<Product>>;

  abstract update(
    id: Product['id'],
    payload: Partial<Product>,
  ): Promise<Product>;

  abstract softDelete(id: Product['id']): Promise<void>;

  abstract softDeleteByKitchenId(kitchenId: Kitchen['id']): Promise<void>;
}
