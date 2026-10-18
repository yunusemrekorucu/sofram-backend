import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FilesService } from '../files/files.service';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { PageQueryDto } from '../orders/dto/list-orders.dto';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import {
  reviewAlreadyReported,
  reviewExists,
  reviewNotAllowed,
} from '../trust/trust-errors';
import { photosByIds } from '../trust/trust-photos';
import { canReview } from '../trust/trust-rules';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { Review } from './domain/review';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListCookReviewsQueryDto } from './dto/list-reviews.dto';
import { ReportReviewDto } from './dto/review-actions.dto';
import {
  DuplicateReviewError,
  DuplicateReviewReportError,
  ReviewPage,
  ReviewRepository,
} from './infrastructure/persistence/review.repository';
import {
  kitchenReviewView,
  orderReviewView,
  reviewReportView,
  reviewView,
  reviewsSummary,
} from './presenters';
import {
  KitchenReviewView,
  KitchenReviewsPage,
  OrderReviewView,
  ReviewReportView,
} from './views';

const textOrNull = (text: string | null | undefined) => text?.trim() || null;

const pageOf = (query: PageQueryDto): ReviewPage => ({
  offset: (query.page - 1) * query.limit,
  limit: query.limit,
});

/** Reviews from the customer, the cook and the admin side. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly orderRepository: OrderRepository,
    private readonly kitchensService: KitchensService,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** 409 reviewExists for a second review, 409 reviewNotAllowed otherwise. */
  async create(
    customerId: User['id'],
    orderId: Order['id'],
    dto: CreateReviewDto,
  ): Promise<OrderReviewView> {
    const order = await orNotFound(
      this.orderRepository.findForCustomer(customerId, orderId),
    );
    const [existing] = await this.reviewRepository.findByOrderIds([order.id]);

    if (existing) {
      throw reviewExists();
    }

    const windowDays = this.configService.getOrThrow('trust.reviewWindowDays', {
      infer: true,
    });

    if (!canReview(order, false, new Date(), windowDays)) {
      throw reviewNotAllowed();
    }

    const photos = await photosByIds(this.filesService, dto.photoIds ?? []);

    try {
      return orderReviewView(
        await this.reviewRepository.create({
          orderId: order.id,
          kitchenId: order.kitchenId,
          authorId: customerId,
          rating: dto.rating,
          taste: dto.taste ?? null,
          portion: dto.portion ?? null,
          packaging: dto.packaging ?? null,
          timing: dto.timing ?? null,
          tags: dto.tags ?? [],
          comment: textOrNull(dto.comment),
          photos,
        }),
      );
    } catch (error) {
      if (error instanceof DuplicateReviewError) {
        throw reviewExists();
      }

      throw error;
    }
  }

  /** Only the author; the kitchen's rating is recomputed. */
  async remove(authorId: User['id'], id: Review['id']): Promise<void> {
    const review = await orNotFound(
      this.reviewRepository.findForAuthor(authorId, id),
    );
    await this.reviewRepository.softDelete(review.id);
  }

  /** Visible reviews of a live kitchen, newest first, with the summary. */
  async kitchenReviews(
    kitchenId: Kitchen['id'],
    query: PageQueryDto,
  ): Promise<KitchenReviewsPage> {
    const kitchen = await orNotFound(this.kitchensService.findById(kitchenId));
    const [reviews, groups, tags] = await Promise.all([
      this.reviewRepository.listVisible(kitchen.id, pageOf(query)),
      this.reviewRepository.ratingGroups(kitchen.id),
      this.reviewRepository.tagCounts(kitchen.id),
    ]);

    return {
      ...infinityPagination(reviews.map(reviewView), {
        page: query.page,
        limit: query.limit,
      }),
      summary: reviewsSummary(groups, tags),
    };
  }

  async listMine(
    ownerId: User['id'],
    query: ListCookReviewsQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenReviewView>> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    const reviews = await this.reviewRepository.listForKitchen(
      kitchen.id,
      query.filter,
      pageOf(query),
    );

    return infinityPagination(reviews.map(kitchenReviewView), {
      page: query.page,
      limit: query.limit,
    });
  }

  /** Writes or replaces the cook's answer. */
  async reply(
    ownerId: User['id'],
    id: Review['id'],
    reply: string,
  ): Promise<KitchenReviewView> {
    const review = await this.mine(ownerId, id);
    return kitchenReviewView(
      await this.reviewRepository.setReply(review.id, reply),
    );
  }

  async removeReply(ownerId: User['id'], id: Review['id']): Promise<void> {
    const review = await this.mine(ownerId, id);
    await this.reviewRepository.setReply(review.id, null);
  }

  /** The review stays visible; an admin decides. Twice → 409 reviewAlreadyReported. */
  async report(
    ownerId: User['id'],
    id: Review['id'],
    dto: ReportReviewDto,
  ): Promise<void> {
    const review = await this.mine(ownerId, id);

    try {
      await this.reviewRepository.addReport({
        reviewId: review.id,
        reporterId: ownerId,
        reason: dto.reason,
        note: textOrNull(dto.note),
      });
    } catch (error) {
      if (error instanceof DuplicateReviewReportError) {
        throw reviewAlreadyReported();
      }

      throw error;
    }
  }

  async listReports(
    query: PageQueryDto,
  ): Promise<InfinityPaginationResponseDto<ReviewReportView>> {
    const reports = await this.reviewRepository.listReports(pageOf(query));
    return infinityPagination(reports.map(reviewReportView), {
      page: query.page,
      limit: query.limit,
    });
  }

  /** Admin: a hidden review leaves the public list and the rating. */
  async setHidden(
    id: Review['id'],
    isHidden: boolean,
  ): Promise<KitchenReviewView> {
    const review = await orNotFound(this.reviewRepository.findById(id));
    return kitchenReviewView(
      await this.reviewRepository.setHidden(review.id, isHidden),
    );
  }

  /** A review of the cook's own kitchen (404 without a kitchen or for another's). */
  private async mine(ownerId: User['id'], id: Review['id']): Promise<Review> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return orNotFound(this.reviewRepository.findForKitchen(kitchen.id, id));
  }
}
