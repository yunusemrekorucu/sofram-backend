import { ReviewReportReason, ReviewTag } from '../trust/trust.enums';
import {
  kitchenReviewView,
  orderReviewView,
  reviewReportView,
  reviewView,
  reviewsSummary,
} from './presenters';
import { aReview } from './review.fixture';

describe('review presenters', () => {
  it('should name the author briefly in the public list', () => {
    const view = reviewView(aReview());

    expect(view).toMatchObject({
      id: 'r1',
      rating: 5,
      authorName: 'Deniz İ.',
      authorPhoto: null,
      tags: ['homemade'],
    });
    expect(view).not.toHaveProperty('authorId');
    expect(view).not.toHaveProperty('author');
    expect(view).not.toHaveProperty('isHidden');
  });

  it('should leave the author out of the customer’s own review', () => {
    const view = orderReviewView(aReview({ reply: 'Afiyet olsun' }));

    expect(view).toMatchObject({
      reply: 'Afiyet olsun',
      comment: 'Annemin mantısı gibi',
    });
    expect(view).not.toHaveProperty('authorName');
  });

  it('should label hidden reviews for the cook', () => {
    expect(kitchenReviewView(aReview({ isHidden: true }))).toMatchObject({
      orderId: 'o1',
      kitchenId: 'k1',
      isHidden: true,
      authorName: 'Deniz İ.',
    });
  });

  it('should carry the reported review', () => {
    expect(
      reviewReportView({
        id: 'rr1',
        reviewId: 'r1',
        reporterId: 7,
        reason: ReviewReportReason.falseClaim,
        note: null,
        review: aReview(),
        createdAt: new Date('2026-10-13T08:00:00Z'),
      }),
    ).toMatchObject({
      id: 'rr1',
      reason: 'false_claim',
      review: { id: 'r1', isHidden: false },
    });
  });

  it('should summarize the counted reviews and the top tags', () => {
    expect(
      reviewsSummary(
        [
          { rating: 5, isHidden: false, isDeleted: false, count: 3 },
          { rating: 4, isHidden: false, isDeleted: false, count: 1 },
          { rating: 1, isHidden: true, isDeleted: false, count: 2 },
        ],
        [
          { tag: ReviewTag.onTime, count: 1 },
          { tag: ReviewTag.homemade, count: 4 },
        ],
      ),
    ).toEqual({
      ratingAvg: 4.8,
      ratingCount: 4,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 3 },
      topTags: ['homemade', 'on_time'],
    });
  });
});
