import { DeepPartial } from '../../../utils/types/deep-partial.type';
import { NullableType } from '../../../utils/types/nullable.type';
import { User } from '../../../users/domain/user';
import { Address } from '../../domain/address';

export abstract class AddressRepository {
  abstract create(
    data: Omit<Address, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Address>;

  /** Default first, then newest first. */
  abstract findByUserId(userId: User['id']): Promise<Address[]>;

  abstract countByUserId(userId: User['id']): Promise<number>;

  abstract findOwned(
    userId: User['id'],
    id: Address['id'],
  ): Promise<NullableType<Address>>;

  abstract update(
    id: Address['id'],
    payload: DeepPartial<Address>,
  ): Promise<Address | null>;

  /** Makes `id` the user's only default, atomically. */
  abstract setDefault(userId: User['id'], id: Address['id']): Promise<void>;

  abstract remove(id: Address['id']): Promise<void>;

  /** Hard-deletes every address of the user (account deletion). */
  abstract removeByUserId(userId: User['id']): Promise<void>;
}
