import { NullableType } from '../../../utils/types/nullable.type';
import { User } from '../../../users/domain/user';
import { Kitchen } from '../../domain/kitchen';

export abstract class KitchenRepository {
  /** A new kitchen starts unrated (ratingAvg null, ratingCount 0). */
  abstract create(
    data: Omit<
      Kitchen,
      'id' | 'createdAt' | 'updatedAt' | 'ratingAvg' | 'ratingCount'
    >,
  ): Promise<Kitchen>;

  abstract findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>>;

  abstract findById(id: Kitchen['id']): Promise<NullableType<Kitchen>>;

  /** Never writes ratingAvg/ratingCount, even when `payload` carries them. */
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
