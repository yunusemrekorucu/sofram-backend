import { shortName } from '../orders/presenters';
import { RatingGroup, ratingSummary, topTags } from '../trust/trust-rules';
import { TagCount } from './infrastructure/persistence/review.repository';
import { Review } from './domain/review';
import { ReviewReport } from './domain/review-report';
import {
  KitchenReviewView,
  OrderReviewView,
  ReviewReportView,
  ReviewView,
  ReviewsSummaryView,
} from './views';

const ownFields = (review: Review) => ({
  id: review.id,
  rating: review.rating,
  taste: review.taste,
  portion: review.portion,
  packaging: review.packaging,
  timing: review.timing,
  tags: review.tags,
  comment: review.comment,
  photos: review.photos,
  reply: review.reply,
  repliedAt: review.repliedAt,
  createdAt: review.createdAt,
});

export const orderReviewView = (review: Review): OrderReviewView =>
  Object.assign(new OrderReviewView(), ownFields(review));

/** The author as "Ad S." with their photo — never a full name. */
export const reviewView = (review: Review): ReviewView =>
  Object.assign(new ReviewView(), ownFields(review), {
    authorName: shortName(review.author),
    authorPhoto: review.author.photo,
  });

export const kitchenReviewView = (review: Review): KitchenReviewView =>
  Object.assign(new KitchenReviewView(), reviewView(review), {
    orderId: review.orderId,
    kitchenId: review.kitchenId,
    isHidden: review.isHidden,
  });

export const reviewReportView = (report: ReviewReport): ReviewReportView =>
  Object.assign(new ReviewReportView(), {
    id: report.id,
    reason: report.reason,
    note: report.note,
    createdAt: report.createdAt,
    review: kitchenReviewView(report.review),
  });

export function reviewsSummary(
  groups: RatingGroup[],
  tags: TagCount[],
): ReviewsSummaryView {
  const { ratingAvg, ratingCount, distribution } = ratingSummary(groups);
  return Object.assign(new ReviewsSummaryView(), {
    ratingAvg,
    ratingCount,
    distribution,
    topTags: topTags(tags),
  });
}
