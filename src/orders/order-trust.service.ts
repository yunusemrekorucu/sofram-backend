import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { OrderIssue } from '../order-issues/domain/order-issue';
import { OrderIssueRepository } from '../order-issues/infrastructure/persistence/order-issue.repository';
import { OrderMessageRepository } from '../order-messages/infrastructure/persistence/order-message.repository';
import { Review } from '../reviews/domain/review';
import { ReviewRepository } from '../reviews/infrastructure/persistence/review.repository';
import { TrustConfig } from '../trust/config/trust-config.type';
import { canMessage, canReportIssue, canReview } from '../trust/trust-rules';
import { IssueStatus, MessageSide } from '../trust/trust.enums';
import { Order } from './domain/order';

export type CustomerOrderTrust = {
  /** null when there is none or it was deleted. */
  review: Review | null;
  canReview: boolean;
  /** The latest report, whatever its status. */
  issue: OrderIssue | null;
  canReportIssue: boolean;
  unreadMessages: number;
  canMessage: boolean;
};

export type CustomerCardTrust = Pick<
  CustomerOrderTrust,
  'unreadMessages' | 'canReview'
>;

export type CookOrderTrust = Pick<
  CustomerOrderTrust,
  'review' | 'issue' | 'unreadMessages' | 'canMessage'
>;

export type CookSummaryTrust = {
  rating: { avg: number | null; count: number };
  unrepliedReviews: number;
  unreadMessages: number;
};

/** What Faz 4 adds to the order screens: review, issue and chat state. */
@Injectable()
export class OrderTrustService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly issueRepository: OrderIssueRepository,
    private readonly messageRepository: OrderMessageRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async forCustomer(
    order: Order,
    now: Date = new Date(),
  ): Promise<CustomerOrderTrust> {
    const [[review], issue, unread] = await Promise.all([
      this.reviewRepository.findByOrderIds([order.id]),
      this.issueRepository.latestForOrder(order.id),
      this.messageRepository.countUnread([order.id], MessageSide.customer),
    ]);
    const windows = this.windows();

    return {
      review: review && !review.deletedAt ? review : null,
      canReview: canReview(
        order,
        Boolean(review),
        now,
        windows.reviewWindowDays,
      ),
      issue,
      canReportIssue: canReportIssue(
        order,
        issue?.status === IssueStatus.open,
        now,
        windows.issueWindowHours,
      ),
      unreadMessages: unread.get(order.id) ?? 0,
      canMessage: canMessage(order, now, windows.messagingWindowHours),
    };
  }

  /** One query per table for a whole page of cards. */
  async forCustomerCards(
    orders: Order[],
    now: Date = new Date(),
  ): Promise<Map<Order['id'], CustomerCardTrust>> {
    const ids = orders.map((order) => order.id);
    const [reviews, unread] = await Promise.all([
      this.reviewRepository.findByOrderIds(ids),
      this.messageRepository.countUnread(ids, MessageSide.customer),
    ]);
    const reviewed = new Set(reviews.map((review) => review.orderId));
    const { reviewWindowDays } = this.windows();

    return new Map(
      orders.map((order) => [
        order.id,
        {
          unreadMessages: unread.get(order.id) ?? 0,
          canReview: canReview(
            order,
            reviewed.has(order.id),
            now,
            reviewWindowDays,
          ),
        },
      ]),
    );
  }

  async forCook(order: Order, now: Date = new Date()): Promise<CookOrderTrust> {
    const [[review], issue, unread] = await Promise.all([
      this.reviewRepository.findByOrderIds([order.id]),
      this.issueRepository.latestForOrder(order.id),
      this.messageRepository.countUnread([order.id], MessageSide.cook),
    ]);

    return {
      review: review && !review.deletedAt ? review : null,
      issue,
      unreadMessages: unread.get(order.id) ?? 0,
      canMessage: canMessage(order, now, this.windows().messagingWindowHours),
    };
  }

  /** Unread customer messages per card of the cook's list. */
  cookUnread(orders: Order[]): Promise<Map<Order['id'], number>> {
    return this.messageRepository.countUnread(
      orders.map((order) => order.id),
      MessageSide.cook,
    );
  }

  async cookSummary(kitchen: Kitchen): Promise<CookSummaryTrust> {
    const [unrepliedReviews, unreadMessages] = await Promise.all([
      this.reviewRepository.countUnreplied(kitchen.id),
      this.messageRepository.countUnreadForKitchen(kitchen.id),
    ]);

    return {
      rating: { avg: kitchen.ratingAvg, count: kitchen.ratingCount },
      unrepliedReviews,
      unreadMessages,
    };
  }

  private windows(): TrustConfig {
    return this.configService.getOrThrow('trust', { infer: true });
  }
}
