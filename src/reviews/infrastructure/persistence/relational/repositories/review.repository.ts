import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  FindOptionsWhere,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { Order } from '../../../../../orders/domain/order';
import { RatingGroup, ratingSummary } from '../../../../../trust/trust-rules';
import { ReviewFilter } from '../../../../../trust/trust.enums';
import { User } from '../../../../../users/domain/user';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { NewReview, Review } from '../../../../domain/review';
import {
  NewReviewReport,
  ReviewReport,
} from '../../../../domain/review-report';
import {
  DuplicateReviewError,
  DuplicateReviewReportError,
  ReviewPage,
  ReviewRepository,
  TagCount,
} from '../../review.repository';
import { ReviewReportEntity } from '../entities/review-report.entity';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewReportMapper } from '../mappers/review-report.mapper';
import { ReviewMapper } from '../mappers/review.mapper';

/** Everything ReviewMapper.toDomain reads. */
const RELATIONS: FindOptionsRelations<ReviewEntity> = {
  author: { photo: true },
};

const NEWEST_FIRST = { createdAt: 'DESC', id: 'DESC' } as const;

const isUniqueViolation = (error: unknown, table: string): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string }).code === '23505' &&
  (error.driverError as { table?: string }).table === table;

/** Grouped exactly as ratingSummary() expects; deleted rows included on purpose. */
async function ratingGroupsOf(
  manager: EntityManager,
  kitchenId: Kitchen['id'],
): Promise<RatingGroup[]> {
  const rows = await manager
    .createQueryBuilder(ReviewEntity, 'r')
    .withDeleted()
    .select('r.rating', 'rating')
    .addSelect('r."isHidden"', 'isHidden')
    .addSelect('r."deletedAt" IS NOT NULL', 'isDeleted')
    .addSelect('COUNT(*)', 'count')
    .where('r."kitchenId" = :kitchenId', { kitchenId })
    .groupBy('r.rating')
    .addGroupBy('r."isHidden"')
    .addGroupBy('r."deletedAt" IS NOT NULL')
    .getRawMany<{
      rating: number;
      isHidden: boolean;
      isDeleted: boolean;
      count: string;
    }>();

  return rows.map((row) => ({
    rating: Number(row.rating),
    isHidden: row.isHidden,
    isDeleted: row.isDeleted,
    count: Number(row.count),
  }));
}

@Injectable()
export class ReviewRelationalRepository implements ReviewRepository {
  constructor(
    @InjectRepository(ReviewEntity)
    private readonly reviews: Repository<ReviewEntity>,
    @InjectRepository(ReviewReportEntity)
    private readonly reports: Repository<ReviewReportEntity>,
  ) {}

  async create(review: NewReview): Promise<Review> {
    let id: string;

    try {
      id = await this.reviews.manager.transaction(async (manager) => {
        await this.lockKitchen(manager, review.kitchenId);
        const { identifiers } = await manager.insert(
          ReviewEntity,
          ReviewMapper.toPersistence(review),
        );
        await this.recompute(manager, review.kitchenId);
        return identifiers[0].id as string;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'review')) {
        throw new DuplicateReviewError();
      }

      throw error;
    }

    return this.findOneOrFail(id);
  }

  findById(id: Review['id']): Promise<NullableType<Review>> {
    return this.findOneWhere({ id });
  }

  findForAuthor(
    authorId: User['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>> {
    return this.findOneWhere({ id, authorId: Number(authorId) });
  }

  findForKitchen(
    kitchenId: Kitchen['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>> {
    return this.findOneWhere({ id, kitchenId });
  }

  async findByOrderIds(orderIds: Order['id'][]): Promise<Review[]> {
    if (orderIds.length === 0) {
      return [];
    }

    const entities = await this.reviews.find({
      where: { orderId: In(orderIds) },
      withDeleted: true,
    });
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  async listVisible(
    kitchenId: Kitchen['id'],
    page: ReviewPage,
  ): Promise<Review[]> {
    const entities = await this.reviews.find({
      where: { kitchenId, isHidden: false },
      relations: RELATIONS,
      order: NEWEST_FIRST,
      skip: page.offset,
      take: page.limit,
    });
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  async listForKitchen(
    kitchenId: Kitchen['id'],
    filter: ReviewFilter,
    page: ReviewPage,
  ): Promise<Review[]> {
    const entities = await this.reviews.find({
      where: {
        kitchenId,
        ...(filter === ReviewFilter.unreplied ? { reply: IsNull() } : {}),
      },
      relations: RELATIONS,
      order: NEWEST_FIRST,
      skip: page.offset,
      take: page.limit,
    });
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  countUnreplied(kitchenId: Kitchen['id']): Promise<number> {
    return this.reviews.count({ where: { kitchenId, reply: IsNull() } });
  }

  ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]> {
    return ratingGroupsOf(this.reviews.manager, kitchenId);
  }

  async tagCounts(kitchenId: Kitchen['id']): Promise<TagCount[]> {
    const rows = await this.reviews.manager.query<
      { tag: TagCount['tag']; count: string }[]
    >(
      `SELECT t.tag, COUNT(*) AS count
       FROM "review" r, unnest(string_to_array(r."tags", ',')) AS t(tag)
       WHERE r."kitchenId" = $1 AND r."deletedAt" IS NULL AND NOT r."isHidden"
       GROUP BY t.tag`,
      [kitchenId],
    );

    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  async softDelete(id: Review['id']): Promise<void> {
    await this.reviews.manager.transaction(async (manager) => {
      const review = await manager.findOneOrFail(ReviewEntity, {
        where: { id },
      });
      await this.lockKitchen(manager, review.kitchenId);
      await manager.softDelete(ReviewEntity, { id });
      await this.recompute(manager, review.kitchenId);
    });
  }

  async setHidden(
    id: Review['id'],
    isHidden: boolean,
  ): Promise<NullableType<Review>> {
    const found = await this.reviews.manager.transaction(async (manager) => {
      const review = await manager.findOne(ReviewEntity, { where: { id } });

      if (!review) {
        return false;
      }

      await this.lockKitchen(manager, review.kitchenId);
      await manager.update(ReviewEntity, { id }, { isHidden });
      await this.recompute(manager, review.kitchenId);
      return true;
    });

    return found ? this.findOneWhere({ id }) : null;
  }

  async setReply(
    id: Review['id'],
    reply: string | null,
  ): Promise<NullableType<Review>> {
    await this.reviews.update(
      { id },
      { reply, repliedAt: reply === null ? null : new Date() },
    );
    return this.findOneWhere({ id });
  }

  async addReport(report: NewReviewReport): Promise<void> {
    try {
      await this.reports.insert({
        ...report,
        reporterId: Number(report.reporterId),
      });
    } catch (error) {
      if (isUniqueViolation(error, 'review_report')) {
        throw new DuplicateReviewReportError();
      }

      throw error;
    }
  }

  async listReports(page: ReviewPage): Promise<ReviewReport[]> {
    const entities = await this.reports
      .createQueryBuilder('rr')
      .innerJoinAndSelect('rr.review', 'r')
      .leftJoinAndSelect('r.author', 'a')
      .leftJoinAndSelect('a.photo', 'p')
      .where('r."deletedAt" IS NULL')
      .orderBy('rr.createdAt', 'DESC')
      .addOrderBy('rr.id', 'DESC')
      .offset(page.offset)
      .limit(page.limit)
      .getMany();

    return entities.map((entity) => ReviewReportMapper.toDomain(entity));
  }

  /** Serializes the rating writers of one kitchen (READ COMMITTED would lose updates). */
  private async lockKitchen(
    manager: EntityManager,
    kitchenId: Kitchen['id'],
  ): Promise<void> {
    await manager.query(
      'SELECT "id" FROM "kitchen" WHERE "id" = $1 FOR UPDATE',
      [kitchenId],
    );
  }

  private async recompute(
    manager: EntityManager,
    kitchenId: Kitchen['id'],
  ): Promise<void> {
    const { ratingAvg, ratingCount } = ratingSummary(
      await ratingGroupsOf(manager, kitchenId),
    );
    await manager.update(
      KitchenEntity,
      { id: kitchenId },
      { ratingAvg, ratingCount },
    );
  }

  private async findOneWhere(
    where: FindOptionsWhere<ReviewEntity>,
  ): Promise<NullableType<Review>> {
    const entity = await this.reviews.findOne({ where, relations: RELATIONS });
    return entity ? ReviewMapper.toDomain(entity) : null;
  }

  private async findOneOrFail(id: Review['id']): Promise<Review> {
    const entity = await this.reviews.findOneOrFail({
      where: { id },
      relations: RELATIONS,
    });
    return ReviewMapper.toDomain(entity);
  }
}
