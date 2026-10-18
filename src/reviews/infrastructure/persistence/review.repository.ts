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

  /** Every review of the kitchen grouped by star, visibility and deletion. */
  abstract ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]>;

  /** How often each tag was picked in visible reviews. */
  abstract tagCounts(kitchenId: Kitchen['id']): Promise<TagCount[]>;

  /** Soft delete + rating recompute. */
  abstract softDelete(id: Review['id']): Promise<void>;

  /** + rating recompute; returns the updated review. */
  abstract setHidden(id: Review['id'], isHidden: boolean): Promise<Review>;

  /** null clears the reply. */
  abstract setReply(id: Review['id'], reply: string | null): Promise<Review>;

  /** DuplicateReviewReportError on a second report by the same cook. */
  abstract addReport(report: NewReviewReport): Promise<void>;

  /** Reports of reviews that are not deleted; newest first. */
  abstract listReports(page: ReviewPage): Promise<ReviewReport[]>;
}
