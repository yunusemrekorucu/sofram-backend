import { FileType } from '../../files/domain/file';
import { Kitchen } from '../../kitchens/domain/kitchen';
import { Order, PersonName } from '../../orders/domain/order';
import { ReviewTag } from '../../trust/trust.enums';
import { User } from '../../users/domain/user';

export type ReviewAuthor = PersonName & { photo: FileType | null };

/** A customer's review of a completed order; cannot be edited, only deleted. */
export class Review {
  id: string;

  orderId: Order['id'];

  kitchenId: Kitchen['id'];

  authorId: User['id'];

  /** 1–5; the only part that counts towards the kitchen's rating. */
  rating: number;

  taste: number | null;

  portion: number | null;

  packaging: number | null;

  timing: number | null;

  tags: ReviewTag[];

  comment: string | null;

  photos: FileType[];

  /** The cook's answer. */
  reply: string | null;

  repliedAt: Date | null;

  /** Hidden by an admin: out of the public list and the rating. */
  isHidden: boolean;

  author: ReviewAuthor;

  createdAt: Date;

  updatedAt: Date;

  deletedAt: Date | null;
}

export type NewReview = Pick<
  Review,
  | 'orderId'
  | 'kitchenId'
  | 'authorId'
  | 'rating'
  | 'taste'
  | 'portion'
  | 'packaging'
  | 'timing'
  | 'tags'
  | 'comment'
  | 'photos'
>;
