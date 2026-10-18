import { Kitchen } from '../../../kitchens/domain/kitchen';
import { User } from '../../../users/domain/user';

export type FavoritePage = { offset: number; limit: number };

export abstract class FavoriteRepository {
  /** Idempotent: a second add changes nothing. */
  abstract add(userId: User['id'], kitchenId: Kitchen['id']): Promise<void>;

  /** Idempotent. */
  abstract remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void>;

  /** The user's favorite kitchens that still exist, most recently added first. */
  abstract listKitchens(
    userId: User['id'],
    page: FavoritePage,
  ): Promise<Kitchen[]>;

  /** Account deletion. */
  abstract removeAllForUser(userId: User['id']): Promise<void>;

  /** Which of `kitchenIds` the user has favorited. */
  abstract favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
  ): Promise<Kitchen['id'][]>;
}
