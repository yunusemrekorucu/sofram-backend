import { Order } from '../orders/domain/order';
import { ACTIVE_STATUSES } from '../orders/order-status';
import { CancelledBy, OrderStatus } from '../orders/order.enums';
import { MessageSide, ReviewTag } from './trust.enums';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A delivery on the way for longer than this counts as stuck and may be reported. */
export const STUCK_DELIVERY_HOURS = 2;

/** How many tags the review summary shows. */
export const TOP_TAG_COUNT = 3;

export type TrustOrder = Pick<
  Order,
  'status' | 'cancelledBy' | 'completedAt' | 'closedAt' | 'onTheWayAt'
>;

/** Completion, or rejection/cancellation/expiry — whichever closed the order. */
const closedAtOf = (order: TrustOrder): Date | null =>
  order.completedAt ?? order.closedAt;

const within = (from: Date, ms: number, now: Date) =>
  from.getTime() + ms > now.getTime();

/**
 * Only a completed order, once (a deleted review counts — reviews cannot be
 * edited by deleting and writing again), within `windowDays` of completion.
 */
export function canReview(
  order: TrustOrder,
  hasReview: boolean,
  now: Date,
  windowDays: number,
): boolean {
  return (
    order.status === OrderStatus.completed &&
    order.completedAt !== null &&
    !hasReview &&
    within(order.completedAt, windowDays * DAY_MS, now)
  );
}

/**
 * A completed order or one the cook cancelled, within `windowHours` of
 * closing; or a delivery stuck on the way. Never while another report of the
 * order is still open.
 */
export function canReportIssue(
  order: TrustOrder,
  hasOpenIssue: boolean,
  now: Date,
  windowHours: number,
): boolean {
  if (hasOpenIssue) {
    return false;
  }

  if (order.status === OrderStatus.onTheWay) {
    return (
      order.onTheWayAt !== null &&
      order.onTheWayAt.getTime() + STUCK_DELIVERY_HOURS * HOUR_MS <
        now.getTime()
    );
  }

  const cancelledByCook =
    order.status === OrderStatus.cancelled &&
    order.cancelledBy === CancelledBy.cook;

  if (order.status !== OrderStatus.completed && !cancelledByCook) {
    return false;
  }

  const closedAt = closedAtOf(order);
  return closedAt !== null && within(closedAt, windowHours * HOUR_MS, now);
}

/** While the order is open and for `windowHours` after it closed; read-only afterwards. */
export function canMessage(
  order: TrustOrder,
  now: Date,
  windowHours: number,
): boolean {
  if (ACTIVE_STATUSES.includes(order.status)) {
    return true;
  }

  const closedAt = closedAtOf(order);
  return closedAt !== null && within(closedAt, windowHours * HOUR_MS, now);
}

export type ReadMarker = 'customerLastReadAt' | 'cookLastReadAt';

/**
 * Unread for `viewer`: the other side's messages written after the viewer's
 * read marker on the order (all of them before the first read). Reading the
 * chat moves `readMarker` to now.
 */
export function unreadRule(viewer: MessageSide): {
  senderRole: MessageSide;
  readMarker: ReadMarker;
} {
  return viewer === MessageSide.customer
    ? { senderRole: MessageSide.cook, readMarker: 'customerLastReadAt' }
    : { senderRole: MessageSide.customer, readMarker: 'cookLastReadAt' };
}

export const RATINGS = [1, 2, 3, 4, 5] as const;

export type Rating = (typeof RATINGS)[number];

export type RatingDistribution = Record<Rating, number>;

/** Reviews of a kitchen grouped by star, visibility and deletion (one SQL GROUP BY). */
export type RatingGroup = {
  rating: number;
  isHidden: boolean;
  isDeleted: boolean;
  count: number;
};

export type RatingSummary = {
  /** One decimal; null without a counted review ("Yeni"). */
  ratingAvg: number | null;
  ratingCount: number;
  distribution: RatingDistribution;
};

/** Hidden and deleted reviews do not count; the average is rounded to one decimal. */
export function ratingSummary(groups: RatingGroup[]): RatingSummary {
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const group of groups) {
    if (!group.isHidden && !group.isDeleted) {
      distribution[group.rating as Rating] += group.count;
    }
  }

  const ratingCount = RATINGS.reduce(
    (sum, star) => sum + distribution[star],
    0,
  );
  const stars = RATINGS.reduce(
    (sum, star) => sum + star * distribution[star],
    0,
  );

  return {
    ratingAvg: ratingCount ? Math.round((stars / ratingCount) * 10) / 10 : null,
    ratingCount,
    distribution,
  };
}

const TAG_ORDER = Object.values(ReviewTag);

/** The most picked tags, most first; a tie keeps the ReviewTag order. */
export function topTags(
  counts: { tag: ReviewTag; count: number }[],
): ReviewTag[] {
  return [...counts]
    .filter((entry) => entry.count > 0 && TAG_ORDER.includes(entry.tag))
    .sort(
      (a, b) =>
        b.count - a.count ||
        TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag),
    )
    .slice(0, TOP_TAG_COUNT)
    .map((entry) => entry.tag);
}
