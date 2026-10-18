import { CookTab, Fulfillment, OrderStatus } from './order.enums';

export const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.pending,
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
  OrderStatus.onTheWay,
];

export const CLOSED_STATUSES: OrderStatus[] = [
  OrderStatus.completed,
  OrderStatus.rejected,
  OrderStatus.cancelled,
  OrderStatus.expired,
];

/** Closing into these hands the portions and the money back. */
export const ROLLBACK_STATUSES: OrderStatus[] = [
  OrderStatus.rejected,
  OrderStatus.cancelled,
  OrderStatus.expired,
];

export type OrderAction =
  | 'accept'
  | 'reject'
  | 'start'
  | 'ready'
  | 'dispatch'
  | 'complete'
  | 'cookCancel'
  | 'customerCancel'
  | 'expire';

export type Transition = { from: OrderStatus[]; to: OrderStatus };

const TRANSITIONS: Record<
  OrderAction,
  (fulfillment: Fulfillment) => Transition | null
> = {
  accept: () => ({ from: [OrderStatus.pending], to: OrderStatus.accepted }),
  reject: () => ({ from: [OrderStatus.pending], to: OrderStatus.rejected }),
  start: () => ({ from: [OrderStatus.accepted], to: OrderStatus.preparing }),
  ready: () => ({ from: [OrderStatus.preparing], to: OrderStatus.ready }),
  dispatch: (fulfillment) =>
    fulfillment === Fulfillment.delivery
      ? { from: [OrderStatus.ready], to: OrderStatus.onTheWay }
      : null,
  // Pickup completes from `ready` with the pickup code; delivery from `on_the_way`.
  complete: (fulfillment) => ({
    from: [
      fulfillment === Fulfillment.pickup
        ? OrderStatus.ready
        : OrderStatus.onTheWay,
    ],
    to: OrderStatus.completed,
  }),
  cookCancel: () => ({
    from: [OrderStatus.accepted, OrderStatus.preparing],
    to: OrderStatus.cancelled,
  }),
  customerCancel: () => ({
    from: [OrderStatus.pending],
    to: OrderStatus.cancelled,
  }),
  expire: () => ({ from: [OrderStatus.pending], to: OrderStatus.expired }),
};

/** null when the action never applies to this fulfillment (dispatch on pickup). */
export function transitionFor(
  action: OrderAction,
  fulfillment: Fulfillment,
): Transition | null {
  return TRANSITIONS[action](fulfillment);
}

export function canTransition(
  status: OrderStatus,
  action: OrderAction,
  fulfillment: Fulfillment,
): boolean {
  return transitionFor(action, fulfillment)?.from.includes(status) ?? false;
}

export type OrderTimestamp =
  | 'acceptedAt'
  | 'preparingAt'
  | 'readyAt'
  | 'onTheWayAt'
  | 'completedAt'
  | 'closedAt';

/** The timestamp written when an order enters a status. */
export const STAMP_FOR: Partial<Record<OrderStatus, OrderTimestamp>> = {
  [OrderStatus.accepted]: 'acceptedAt',
  [OrderStatus.preparing]: 'preparingAt',
  [OrderStatus.ready]: 'readyAt',
  [OrderStatus.onTheWay]: 'onTheWayAt',
  [OrderStatus.completed]: 'completedAt',
  [OrderStatus.rejected]: 'closedAt',
  [OrderStatus.cancelled]: 'closedAt',
  [OrderStatus.expired]: 'closedAt',
};

/** `done` is further limited to orders closed today (Istanbul). */
export const COOK_TAB_STATUSES: Record<CookTab, OrderStatus[]> = {
  [CookTab.new]: [OrderStatus.pending],
  [CookTab.preparing]: [OrderStatus.accepted, OrderStatus.preparing],
  [CookTab.ready]: [OrderStatus.ready, OrderStatus.onTheWay],
  [CookTab.done]: CLOSED_STATUSES,
};
