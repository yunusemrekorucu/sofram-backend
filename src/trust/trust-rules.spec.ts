import { CancelledBy, OrderStatus } from '../orders/order.enums';
import {
  TrustOrder,
  canMessage,
  canReportIssue,
  canReview,
  ratingSummary,
  topTags,
  unreadRule,
} from './trust-rules';
import { MessageSide, ReviewTag } from './trust.enums';

const HOUR = 3_600_000;
const CLOSED = new Date('2026-10-12T10:00:00Z');
const after = (hours: number) => new Date(CLOSED.getTime() + hours * HOUR);

const order = (overrides: Partial<TrustOrder> = {}): TrustOrder => ({
  status: OrderStatus.completed,
  cancelledBy: null,
  completedAt: CLOSED,
  closedAt: null,
  onTheWayAt: null,
  ...overrides,
});

describe('canReview', () => {
  it('should allow a completed order without a review for 7 days', () => {
    expect(canReview(order(), false, after(1), 7)).toBe(true);
    expect(canReview(order(), false, after(7 * 24 - 0.01), 7)).toBe(true);
  });

  it('should close exactly 7 days after completion', () => {
    expect(canReview(order(), false, after(7 * 24), 7)).toBe(false);
    expect(canReview(order(), false, after(8 * 24), 7)).toBe(false);
  });

  it('should refuse a second review', () => {
    expect(canReview(order(), true, after(1), 7)).toBe(false);
  });

  it('should refuse every status but completed', () => {
    for (const status of Object.values(OrderStatus)) {
      if (status !== OrderStatus.completed) {
        expect(
          canReview(order({ status, closedAt: CLOSED }), false, after(1), 7),
        ).toBe(false);
      }
    }
  });
});

describe('canReportIssue', () => {
  it('should allow a completed order for 48 hours', () => {
    expect(canReportIssue(order(), false, after(47.9), 48)).toBe(true);
    expect(canReportIssue(order(), false, after(48), 48)).toBe(false);
  });

  it('should allow an order the cook cancelled, counted from closing', () => {
    const cancelled = order({
      status: OrderStatus.cancelled,
      cancelledBy: CancelledBy.cook,
      completedAt: null,
      closedAt: CLOSED,
    });

    expect(canReportIssue(cancelled, false, after(10), 48)).toBe(true);
    expect(canReportIssue(cancelled, false, after(49), 48)).toBe(false);
  });

  it('should refuse a customer cancellation, a rejection and an expiry', () => {
    for (const closed of [
      { status: OrderStatus.cancelled, cancelledBy: CancelledBy.customer },
      { status: OrderStatus.rejected, cancelledBy: null },
      { status: OrderStatus.expired, cancelledBy: CancelledBy.system },
    ]) {
      expect(
        canReportIssue(
          order({ ...closed, completedAt: null, closedAt: CLOSED }),
          false,
          after(1),
          48,
        ),
      ).toBe(false);
    }
  });

  it('should allow a delivery stuck on the way for more than 2 hours', () => {
    const onTheWay = order({
      status: OrderStatus.onTheWay,
      completedAt: null,
      onTheWayAt: CLOSED,
    });

    expect(canReportIssue(onTheWay, false, after(1.9), 48)).toBe(false);
    expect(canReportIssue(onTheWay, false, after(2), 48)).toBe(false);
    expect(canReportIssue(onTheWay, false, after(2.1), 48)).toBe(true);
  });

  it('should refuse the other active statuses', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
    ]) {
      expect(
        canReportIssue(
          order({ status, completedAt: null }),
          false,
          after(5),
          48,
        ),
      ).toBe(false);
    }
  });

  it('should refuse while a report of the order is open', () => {
    expect(canReportIssue(order(), true, after(1), 48)).toBe(false);
  });
});

describe('canMessage', () => {
  it('should allow every active order', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
      OrderStatus.onTheWay,
    ]) {
      expect(
        canMessage(order({ status, completedAt: null }), after(100), 24),
      ).toBe(true);
    }
  });

  it('should allow 24 hours after completion or closing, then go read-only', () => {
    const rejected = order({
      status: OrderStatus.rejected,
      completedAt: null,
      closedAt: CLOSED,
    });

    expect(canMessage(order(), after(23.9), 24)).toBe(true);
    expect(canMessage(order(), after(24), 24)).toBe(false);
    expect(canMessage(rejected, after(23.9), 24)).toBe(true);
    expect(canMessage(rejected, after(24.1), 24)).toBe(false);
  });
});

describe('unreadRule', () => {
  it('should count the cook’s messages after the customer’s marker', () => {
    expect(unreadRule(MessageSide.customer)).toEqual({
      senderRole: MessageSide.cook,
      readMarker: 'customerLastReadAt',
    });
  });

  it('should count the customer’s messages after the cook’s marker', () => {
    expect(unreadRule(MessageSide.cook)).toEqual({
      senderRole: MessageSide.customer,
      readMarker: 'cookLastReadAt',
    });
  });
});

describe('ratingSummary', () => {
  const group = (rating: number, count: number, extra = {}) => ({
    rating,
    count,
    isHidden: false,
    isDeleted: false,
    ...extra,
  });

  it('should average to one decimal and fill every star', () => {
    expect(ratingSummary([group(5, 2), group(4, 1)])).toEqual({
      ratingAvg: 4.7,
      ratingCount: 3,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 },
    });
  });

  it('should round halves up', () => {
    // 87 / 20 = 4.35
    expect(ratingSummary([group(5, 7), group(4, 13)]).ratingAvg).toBe(4.4);
    // 9 / 4 = 2.25
    expect(ratingSummary([group(3, 1), group(2, 3)]).ratingAvg).toBe(2.3);
  });

  it('should leave hidden and deleted reviews out', () => {
    expect(
      ratingSummary([
        group(5, 1),
        group(1, 3, { isHidden: true }),
        group(1, 2, { isDeleted: true }),
      ]),
    ).toEqual({
      ratingAvg: 5,
      ratingCount: 1,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    });
  });

  it('should have no average without a counted review', () => {
    expect(ratingSummary([group(4, 1, { isHidden: true })])).toEqual({
      ratingAvg: null,
      ratingCount: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });
});

describe('topTags', () => {
  it('should keep the three most picked tags, most first', () => {
    expect(
      topTags([
        { tag: ReviewTag.onTime, count: 1 },
        { tag: ReviewTag.homemade, count: 5 },
        { tag: ReviewTag.arrivedHot, count: 3 },
        { tag: ReviewTag.friendlyCook, count: 2 },
      ]),
    ).toEqual([
      ReviewTag.homemade,
      ReviewTag.arrivedHot,
      ReviewTag.friendlyCook,
    ]);
  });

  it('should break ties by the tag order', () => {
    expect(
      topTags([
        { tag: ReviewTag.friendlyCook, count: 2 },
        { tag: ReviewTag.generousPortion, count: 2 },
      ]),
    ).toEqual([ReviewTag.generousPortion, ReviewTag.friendlyCook]);
  });

  it('should be empty without tags', () => {
    expect(topTags([])).toEqual([]);
  });
});
