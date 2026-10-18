import { NullableType } from '../../../utils/types/nullable.type';
import { User } from '../../../users/domain/user';
import { Kitchen } from '../../domain/kitchen';

export abstract class KitchenRepository {
  abstract create(
    data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Kitchen>;

  abstract findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>>;

  abstract findById(id: Kitchen['id']): Promise<NullableType<Kitchen>>;

  abstract update(
    id: Kitchen['id'],
    payload: Partial<Kitchen>,
  ): Promise<Kitchen>;

  /**
   * Account deletion: soft-deletes the kitchen and scrubs its personal data
   * (KVKK; it holds a copy of an address that is hard-deleted).
   */
  abstract anonymizeAndSoftDeleteByOwnerId(ownerId: User['id']): Promise<void>;
}
