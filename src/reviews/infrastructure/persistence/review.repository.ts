import { Kitchen } from '../../../kitchens/domain/kitchen';
import { Order } from '../../../orders/domain/order';
import { RatingGroup } from '../../../trust/trust-rules';
import { ReviewFilter, ReviewTag } from '../../../trust/trust.enums';
import { User } from '../../../users/domain/user';
import { NullableType } from '../../../utils/types/nullable.type';
import { NewReview, Review } from '../../domain/review';
import { NewReviewReport, ReviewReport } from '../../domain/review-report';

export type ReviewPage = { offset: number; limit: number };

export type TagCount = { tag: ReviewTag; count: number };

/** The order already has a review — deleted ones included (unique orderId). */
export class DuplicateReviewError extends Error {}

/** This cook already reported this review (unique reviewId + reporterId). */
export class DuplicateReviewReportError extends Error {}

/**
 * Reviews and the kitchen rating they feed. Every write that changes which
 * reviews count (create, delete, hide) locks the kitchen row and recomputes
 * `kitchen.ratingAvg` / `ratingCount` in the same transaction.
 */
export abstract class ReviewRepository {
  /** DuplicateReviewError when the order already has one. */
  abstract create(review: NewReview): Promise<Review>;

  /** Not deleted; hidden included. */
  abstract findById(id: Review['id']): Promise<NullableType<Review>>;

  /** Not deleted; hidden included. */
  abstract findForAuthor(
    authorId: User['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>>;

  /** Not deleted; hidden included. */
  abstract findForKitchen(
    kitchenId: Kitchen['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>>;

  /** The reviews of these orders, deleted ones included (they still block a new one). */
  abstract findByOrderIds(orderIds: Order['id'][]): Promise<Review[]>;

  /** Not hidden, not deleted; newest first. */
  abstract listVisible(
    kitchenId: Kitchen['id'],
    page: ReviewPage,
  ): Promise<Review[]>;

  /** The cook's list: hidden ones included; newest first. */
  abstract listForKitchen(
    kitchenId: Kitchen['id'],
    filter: ReviewFilter,
    page: ReviewPage,
  ): Promise<Review[]>;

  /** Live reviews of the kitchen without a reply (hidden ones included, like the cook's list). */
  abstract countUnreplied(kitchenId: Kitchen['id']): Promise<number>;

  /** Every review of the kitchen grouped by star, visibility and deletion. */
  abstract ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]>;

  /** How often each tag was picked in visible reviews. */
  abstract tagCounts(kitchenId: Kitchen['id']): Promise<TagCount[]>;

  /** Soft delete + rating recompute. */
  abstract softDelete(id: Review['id']): Promise<void>;

  /** + rating recompute; the updated review, null when it is gone (deleted meanwhile). */
  abstract setHidden(
    id: Review['id'],
    isHidden: boolean,
  ): Promise<NullableType<Review>>;

  /** null clears the reply; returns null when the review is gone. */
  abstract setReply(
    id: Review['id'],
    reply: string | null,
  ): Promise<NullableType<Review>>;

  /** DuplicateReviewReportError on a second report by the same cook. */
  abstract addReport(report: NewReviewReport): Promise<void>;

  /** Reports of reviews that are not deleted; newest first. */
  abstract listReports(page: ReviewPage): Promise<ReviewReport[]>;

  /**
   * Account deletion of a customer: their reviews are soft-deleted with the
   * comment and photos scrubbed (KVKK), and every affected kitchen's rating
   * is recomputed — one transaction.
   */
  abstract softDeleteByAuthor(authorId: User['id']): Promise<void>;

  /** Account deletion of a cook: the kitchen's reviews go, their replies scrubbed. */
  abstract softDeleteByKitchen(kitchenId: Kitchen['id']): Promise<void>;
}
