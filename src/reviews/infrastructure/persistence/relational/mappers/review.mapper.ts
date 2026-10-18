import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { FileMapper } from '../../../../../files/infrastructure/persistence/relational/mappers/file.mapper';
import { NewReview, Review } from '../../../../domain/review';
import { ReviewEntity } from '../entities/review.entity';

export class ReviewMapper {
  /** Expects `author` joined (a soft-deleted user still loads through the relation) — ReviewRelationalRepository always joins it. */
  static toDomain(raw: ReviewEntity): Review {
    return Object.assign(new Review(), {
      id: raw.id,
      orderId: raw.orderId,
      kitchenId: raw.kitchenId,
      authorId: raw.authorId,
      rating: raw.rating,
      taste: raw.taste,
      portion: raw.portion,
      packaging: raw.packaging,
      timing: raw.timing,
      tags: raw.tags,
      comment: raw.comment,
      photos: raw.photos.map(toFileType),
      reply: raw.reply,
      repliedAt: raw.repliedAt,
      isHidden: raw.isHidden,
      author: {
        firstName: raw.author?.firstName ?? null,
        lastName: raw.author?.lastName ?? null,
        photo: raw.author?.photo ? FileMapper.toDomain(raw.author.photo) : null,
      },
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt,
    });
  }

  static toPersistence(review: NewReview): ReviewEntity {
    return Object.assign(new ReviewEntity(), {
      ...review,
      authorId: Number(review.authorId),
      photos: review.photos.map(toSnapshot),
    });
  }
}
