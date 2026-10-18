import { FileType } from '../../../../../files/domain/file';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { ReviewTag } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewMapper } from './review.mapper';

const CREATED = new Date('2026-10-12T09:30:00Z');

const entity = (overrides: Partial<ReviewEntity> = {}): ReviewEntity =>
  Object.assign(new ReviewEntity(), {
    id: 'r1',
    orderId: 'o1',
    kitchenId: 'k1',
    authorId: 9,
    rating: 5,
    taste: 5,
    portion: null,
    packaging: null,
    timing: 4,
    tags: [ReviewTag.homemade, ReviewTag.arrivedHot],
    comment: 'Annemin mantısı gibi',
    photos: [{ id: 'f1', path: '/f1.png' }],
    reply: null,
    repliedAt: null,
    isHidden: false,
    author: Object.assign(new UserEntity(), {
      firstName: 'Deniz',
      lastName: 'Arslan',
      photo: Object.assign(new FileEntity(), { id: 'u1', path: '/u1.png' }),
    }),
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  });

describe('ReviewMapper', () => {
  it('should turn photo snapshots into files and carry the author', () => {
    const review = ReviewMapper.toDomain(entity());

    expect(review.photos[0]).toBeInstanceOf(FileType);
    expect(review).toMatchObject({
      rating: 5,
      taste: 5,
      portion: null,
      tags: ['homemade', 'arrived_hot'],
      author: {
        firstName: 'Deniz',
        lastName: 'Arslan',
        photo: { id: 'u1', path: '/u1.png' },
      },
    });
  });

  it('should cope with an anonymized author', () => {
    const review = ReviewMapper.toDomain(
      entity({
        author: Object.assign(new UserEntity(), {
          firstName: null,
          lastName: null,
          photo: null,
        }),
      }),
    );

    expect(review.author).toEqual({
      firstName: null,
      lastName: null,
      photo: null,
    });
  });

  it('should store files as snapshots and the author id as a number', () => {
    const row = ReviewMapper.toPersistence({
      orderId: 'o1',
      kitchenId: 'k1',
      authorId: '9',
      rating: 4,
      taste: null,
      portion: null,
      packaging: null,
      timing: null,
      tags: [],
      comment: null,
      photos: [Object.assign(new FileType(), { id: 'f1', path: '/f1.png' })],
    });

    expect(row).toMatchObject({
      authorId: 9,
      photos: [{ id: 'f1', path: '/f1.png' }],
    });
    expect(row.photos[0]).not.toBeInstanceOf(FileType);
  });
});
