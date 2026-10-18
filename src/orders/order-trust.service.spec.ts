import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { OrderIssueRepository } from '../order-issues/infrastructure/persistence/order-issue.repository';
import { anIssue } from '../order-issues/order-issue.fixture';
import { OrderMessageRepository } from '../order-messages/infrastructure/persistence/order-message.repository';
import { ReviewRepository } from '../reviews/infrastructure/persistence/review.repository';
import { aReview } from '../reviews/review.fixture';
import { IssueStatus, MessageSide } from '../trust/trust.enums';
import { OrderTrustService } from './order-trust.service';
import { anOrder } from './order.fixture';
import { OrderStatus } from './order.enums';

const NOW = new Date('2026-10-13T10:00:00Z');
// Completed two hours ago: every window is still open.
const completed = anOrder({
  status: OrderStatus.completed,
  completedAt: new Date('2026-10-13T08:00:00Z'),
});

const build = () => {
  const reviews = {
    findByOrderIds: jest.fn().mockResolvedValue([]),
    countUnreplied: jest.fn().mockResolvedValue(3),
  };
  const issues = { latestForOrder: jest.fn().mockResolvedValue(null) };
  const messages = {
    countUnread: jest.fn().mockResolvedValue(new Map([['o1', 2]])),
    countUnreadForKitchen: jest.fn().mockResolvedValue(5),
  };
  const config = {
    getOrThrow: (key: string) =>
      ({
        trust: {
          reviewWindowDays: 7,
          issueWindowHours: 48,
          messagingWindowHours: 24,
          supportEmail: 'destek@sofram.local',
        },
      })[key],
  };

  const service = new OrderTrustService(
    reviews as unknown as ReviewRepository,
    issues as unknown as OrderIssueRepository,
    messages as unknown as OrderMessageRepository,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, reviews, issues, messages };
};

describe('OrderTrustService', () => {
  it('should open review, issue and chat on a fresh completed order', async () => {
    const { service, messages } = build();

    await expect(service.forCustomer(completed, NOW)).resolves.toEqual({
      review: null,
      canReview: true,
      issue: null,
      canReportIssue: true,
      unreadMessages: 2,
      canMessage: true,
    });
    expect(messages.countUnread).toHaveBeenCalledWith(
      ['o1'],
      MessageSide.customer,
    );
  });

  it('should hide a deleted review but still refuse a new one', async () => {
    const { service, reviews } = build();
    reviews.findByOrderIds.mockResolvedValue([
      aReview({ deletedAt: new Date('2026-10-12T12:00:00Z') }),
    ]);

    await expect(service.forCustomer(completed, NOW)).resolves.toMatchObject({
      review: null,
      canReview: false,
    });
  });

  it('should refuse a report while the latest one is open, not after it closed', async () => {
    const { service, issues } = build();

    issues.latestForOrder.mockResolvedValue(anIssue());
    expect((await service.forCustomer(completed, NOW)).canReportIssue).toBe(
      false,
    );

    issues.latestForOrder.mockResolvedValue(
      anIssue({ status: IssueStatus.resolved }),
    );
    await expect(service.forCustomer(completed, NOW)).resolves.toMatchObject({
      issue: { status: IssueStatus.resolved },
      canReportIssue: true,
    });
  });

  it('should answer a page of cards with one query per table', async () => {
    const { service, reviews } = build();
    const second = anOrder({ ...completed, id: 'o2' });
    reviews.findByOrderIds.mockResolvedValue([aReview({ orderId: 'o2' })]);

    const cards = await service.forCustomerCards([completed, second], NOW);

    expect(reviews.findByOrderIds).toHaveBeenCalledWith(['o1', 'o2']);
    expect(cards.get('o1')).toEqual({ unreadMessages: 2, canReview: true });
    expect(cards.get('o2')).toEqual({ unreadMessages: 0, canReview: false });
  });

  it('should give the cook the review, the issue and the customer’s unread messages', async () => {
    const { service, reviews, messages } = build();
    reviews.findByOrderIds.mockResolvedValue([aReview()]);

    await expect(service.forCook(completed, NOW)).resolves.toMatchObject({
      review: { id: 'r1' },
      issue: null,
      unreadMessages: 2,
      canMessage: true,
    });
    expect(messages.countUnread).toHaveBeenCalledWith(['o1'], MessageSide.cook);
  });

  it('should sum up the cook’s rating, unreplied reviews and unread messages', async () => {
    const { service } = build();

    await expect(
      service.cookSummary(
        Object.assign(new Kitchen(), {
          id: 'k1',
          ratingAvg: 4.8,
          ratingCount: 12,
        }),
      ),
    ).resolves.toEqual({
      rating: { avg: 4.8, count: 12 },
      unrepliedReviews: 3,
      unreadMessages: 5,
    });
  });
});
