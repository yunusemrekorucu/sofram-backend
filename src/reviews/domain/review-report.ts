import { ReviewReportReason } from '../../trust/trust.enums';
import { User } from '../../users/domain/user';
import { Review } from './review';

/** A cook's report of a review; an admin decides whether to hide it. */
export class ReviewReport {
  id: string;

  reviewId: Review['id'];

  reporterId: User['id'];

  reason: ReviewReportReason;

  note: string | null;

  /** The reported review, hidden or not. */
  review: Review;

  createdAt: Date;
}

export type NewReviewReport = Pick<
  ReviewReport,
  'reviewId' | 'reporterId' | 'reason' | 'note'
>;
