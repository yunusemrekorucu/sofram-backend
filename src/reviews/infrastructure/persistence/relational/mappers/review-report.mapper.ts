import { ReviewReport } from '../../../../domain/review-report';
import { ReviewReportEntity } from '../entities/review-report.entity';
import { ReviewMapper } from './review.mapper';

export class ReviewReportMapper {
  /** Expects `review` (+ its author) joined. */
  static toDomain(raw: ReviewReportEntity): ReviewReport {
    return Object.assign(new ReviewReport(), {
      id: raw.id,
      reviewId: raw.reviewId,
      reporterId: raw.reporterId,
      reason: raw.reason,
      note: raw.note,
      review: ReviewMapper.toDomain(
        raw.review as NonNullable<typeof raw.review>,
      ),
      createdAt: raw.createdAt,
    });
  }
}
