import { NullableType } from '../../../utils/types/nullable.type';
import { User } from '../../../users/domain/user';
import { Kitchen } from '../../domain/kitchen';

export abstract class KitchenRepository {
  abstract create(
    data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Kitchen>;

  abstract findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>>;

  abstract update(
    id: Kitchen['id'],
    payload: Partial<Kitchen>,
  ): Promise<Kitchen>;

  abstract softDeleteByOwnerId(ownerId: User['id']): Promise<void>;
}
