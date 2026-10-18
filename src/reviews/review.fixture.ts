import { FileType } from '../files/domain/file';
import { ReviewTag } from '../trust/trust.enums';
import { Review } from './domain/review';

/** Unit-test fixture for the review specs. */
export const aReview = (overrides: Partial<Review> = {}): Review =>
  Object.assign(new Review(), {
    id: 'r1',
    orderId: 'o1',
    kitchenId: 'k1',
    authorId: 9,
    rating: 5,
    taste: 5,
    portion: null,
    packaging: null,
    timing: null,
    tags: [ReviewTag.homemade],
    comment: 'Annemin mantısı gibi',
    photos: [Object.assign(new FileType(), { id: 'f1', path: '/f1.png' })],
    reply: null,
    repliedAt: null,
    isHidden: false,
    author: { firstName: 'Deniz', lastName: 'İnce', photo: null },
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    deletedAt: null,
    ...overrides,
  });
