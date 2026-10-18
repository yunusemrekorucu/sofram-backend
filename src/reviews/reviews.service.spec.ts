import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { anOrder } from '../orders/order.fixture';
import { OrderStatus } from '../orders/order.enums';
import {
  ReviewFilter,
  ReviewReportReason,
  ReviewTag,
} from '../trust/trust.enums';
import {
  DuplicateReviewError,
  DuplicateReviewReportError,
  ReviewRepository,
} from './infrastructure/persistence/review.repository';
import { aReview } from './review.fixture';
import { ReviewsService } from './reviews.service';

const NOW = new Date('2026-10-14T10:00:00Z');
const completed = anOrder({
  status: OrderStatus.completed,
  completedAt: new Date('2026-10-12T10:00:00Z'),
});

const conflictKey = (error: unknown) =>
  ((error as ConflictException).getResponse() as { error: string }).error;

const build = (order: Order | null = completed) => {
  const reviews = {
    create: jest
      .fn()
      .mockImplementation((data) => Promise.resolve(aReview(data))),
    findForAuthor: jest.fn().mockResolvedValue(aReview()),
    findForKitchen: jest.fn().mockResolvedValue(aReview()),
    findById: jest.fn().mockResolvedValue(aReview()),
    findByOrderIds: jest.fn().mockResolvedValue([]),
    listVisible: jest.fn().mockResolvedValue([aReview()]),
    listForKitchen: jest.fn().mockResolvedValue([aReview()]),
    ratingGroups: jest
      .fn()
      .mockResolvedValue([
        { rating: 5, isHidden: false, isDeleted: false, count: 1 },
      ]),
    tagCounts: jest
      .fn()
      .mockResolvedValue([{ tag: ReviewTag.homemade, count: 1 }]),
    softDelete: jest.fn().mockResolvedValue(undefined),
    setHidden: jest
      .fn()
      .mockImplementation((id, isHidden) =>
        Promise.resolve(aReview({ id, isHidden })),
      ),
    setReply: jest
      .fn()
      .mockImplementation((id, reply) =>
        Promise.resolve(aReview({ id, reply })),
      ),
    addReport: jest.fn().mockResolvedValue(undefined),
    listReports: jest.fn().mockResolvedValue([]),
  };
  const orders = { findForCustomer: jest.fn().mockResolvedValue(order) };
  const kitchens = {
    findById: jest.fn().mockResolvedValue({ id: 'k1' }),
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const files = {
    findByIds: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids
          .filter((id) => id !== 'missing')
          .map((id) => Object.assign(new FileType(), { id, path: `/${id}` })),
      ),
    ),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'trust.reviewWindowDays': 7 })[key],
  };

  const service = new ReviewsService(
    reviews as unknown as ReviewRepository,
    orders as unknown as OrderRepository,
    kitchens as unknown as KitchensService,
    files as unknown as FilesService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, reviews, orders, kitchens };
};

describe('ReviewsService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('should store the review against the order’s kitchen', async () => {
      const { service, reviews } = build();

      const view = await service.create(9, 'o1', {
        rating: 4,
        taste: 5,
        tags: [ReviewTag.arrivedHot],
        comment: '  Sıcacık geldi  ',
        photoIds: ['f9'],
      });

      expect(reviews.create).toHaveBeenCalledWith({
        orderId: 'o1',
        kitchenId: 'k1',
        authorId: 9,
        rating: 4,
        taste: 5,
        portion: null,
        packaging: null,
        timing: null,
        tags: [ReviewTag.arrivedHot],
        comment: 'Sıcacık geldi',
        photos: [expect.objectContaining({ id: 'f9' })],
      });
      expect(view).toMatchObject({ rating: 4, comment: 'Sıcacık geldi' });
      expect(view).not.toHaveProperty('authorName');
    });

    it('should 404 someone else’s order', async () => {
      const { service } = build(null);

      await expect(
        service.create(9, 'o1', { rating: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should 409 reviewExists when the order has a review, deleted or not', async () => {
      const { service, reviews } = build();
      reviews.findByOrderIds.mockResolvedValue([
        aReview({ deletedAt: new Date() }),
      ]);

      const error = await service
        .create(9, 'o1', { rating: 5 })
        .catch((e) => e);

      expect(conflictKey(error)).toBe('reviewExists');
      expect(reviews.create).not.toHaveBeenCalled();
    });

    it('should 409 reviewNotAllowed before completion and after 7 days', async () => {
      for (const order of [
        anOrder({ status: OrderStatus.onTheWay }),
        anOrder({
          status: OrderStatus.completed,
          completedAt: new Date('2026-10-07T09:59:00Z'),
        }),
      ]) {
        const { service } = build(order);

        const error = await service
          .create(9, 'o1', { rating: 5 })
          .catch((e) => e);

        expect(conflictKey(error)).toBe('reviewNotAllowed');
      }
    });

    it('should turn a concurrent duplicate into reviewExists', async () => {
      const { service, reviews } = build();
      reviews.create.mockRejectedValue(new DuplicateReviewError());

      const error = await service
        .create(9, 'o1', { rating: 5 })
        .catch((e) => e);

      expect(conflictKey(error)).toBe('reviewExists');
    });

    it('should 422 an unknown photo', async () => {
      const { service } = build();

      await expect(
        service.create(9, 'o1', { rating: 5, photoIds: ['missing'] }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  it('should let only the author delete a review', async () => {
    const { service, reviews } = build();

    await service.remove(9, 'r1');
    expect(reviews.findForAuthor).toHaveBeenCalledWith(9, 'r1');
    expect(reviews.softDelete).toHaveBeenCalledWith('r1');

    reviews.findForAuthor.mockResolvedValue(null);
    await expect(service.remove(10, 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should list a kitchen’s visible reviews with the summary', async () => {
    const { service, reviews } = build();

    const page = await service.kitchenReviews('k1', { page: 2, limit: 1 });

    expect(reviews.listVisible).toHaveBeenCalledWith('k1', {
      offset: 1,
      limit: 1,
    });
    expect(page).toMatchObject({
      data: [{ id: 'r1', authorName: 'Deniz İ.' }],
      hasNextPage: true,
      summary: { ratingAvg: 5, ratingCount: 1, topTags: ['homemade'] },
    });
  });

  it('should 404 the reviews of a kitchen that is gone', async () => {
    const { service, kitchens } = build();
    kitchens.findById.mockResolvedValue(null);

    await expect(
      service.kitchenReviews('k1', { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should list the cook’s reviews with the filter', async () => {
    const { service, reviews } = build();

    await service.listMine(7, {
      filter: ReviewFilter.unreplied,
      page: 1,
      limit: 20,
    });

    expect(reviews.listForKitchen).toHaveBeenCalledWith(
      'k1',
      ReviewFilter.unreplied,
      { offset: 0, limit: 20 },
    );
  });

  it('should reply only to reviews of the cook’s kitchen', async () => {
    const { service, reviews } = build();

    await expect(service.reply(7, 'r1', 'Teşekkürler')).resolves.toMatchObject({
      reply: 'Teşekkürler',
    });
    await service.removeReply(7, 'r1');
    expect(reviews.setReply).toHaveBeenLastCalledWith('r1', null);

    reviews.findForKitchen.mockResolvedValue(null);
    await expect(service.reply(7, 'r2', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should report once, then 409 reviewAlreadyReported', async () => {
    const { service, reviews } = build();

    await service.report(7, 'r1', {
      reason: ReviewReportReason.offensive,
      note: '  ',
    });
    expect(reviews.addReport).toHaveBeenCalledWith({
      reviewId: 'r1',
      reporterId: 7,
      reason: ReviewReportReason.offensive,
      note: null,
    });

    reviews.addReport.mockRejectedValue(new DuplicateReviewReportError());
    const error = await service
      .report(7, 'r1', { reason: ReviewReportReason.other })
      .catch((e) => e);
    expect(conflictKey(error)).toBe('reviewAlreadyReported');
  });

  it('should hide a live review and 404 a missing one', async () => {
    const { service, reviews } = build();

    await expect(service.setHidden('r1', true)).resolves.toMatchObject({
      isHidden: true,
    });

    reviews.findById.mockResolvedValue(null);
    await expect(service.setHidden('r2', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
