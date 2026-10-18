import { Kitchen } from '../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../payments/domain/payment';
import { User } from '../../../users/domain/user';
import { NullableType } from '../../../utils/types/nullable.type';
import { NewOrder, Order, OrderPatch } from '../../domain/order';
import { CookTab, OrderStatus } from '../../order.enums';

/** A daily-portion product and how many portions the order takes. */
export type PortionTake = { productId: string; quantity: number };

export type OrderPage = { offset: number; limit: number };

export type OverdueScope = {
  customerId?: User['id'];
  kitchenId?: Kitchen['id'];
};

export type CompletedTotals = { orders: number; revenueKurus: number };

/** Someone took the last portions between the quote and the order. */
export class InsufficientPortionsError extends Error {
  constructor(readonly productId: string) {
    super(`Not enough portions left of product ${productId}`);
  }
}

/** The same Idempotency-Key was used concurrently; the other request won. */
export class DuplicateOrderRequestError extends Error {}

export abstract class OrderRepository {
  /**
   * One transaction: insert the order (with a fresh code), its items and the
   * request key, take the daily portions, call `charge`, store the payment it
   * returns. Anything thrown — InsufficientPortionsError,
   * DuplicateOrderRequestError or the charge's own error — rolls it all back.
   */
  abstract place(
    input: { order: NewOrder; requestKey: string; portions: PortionTake[] },
    charge: (order: Pick<Order, 'id' | 'totalKurus'>) => Promise<NewPayment>,
  ): Promise<Order>;

  abstract findIdByRequestKey(
    customerId: User['id'],
    key: string,
  ): Promise<NullableType<Order['id']>>;

  abstract findById(id: Order['id']): Promise<NullableType<Order>>;

  abstract findForCustomer(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>>;

  abstract findForKitchen(
    kitchenId: Kitchen['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>>;

  /** Newest first. */
  abstract listForCustomer(
    customerId: User['id'],
    statuses: OrderStatus[],
    page: OrderPage,
  ): Promise<Order[]>;

  /** Oldest first; `done` is today's closed orders (since `dayStart`), newest first. */
  abstract listForKitchen(
    kitchenId: Kitchen['id'],
    tab: CookTab,
    dayStart: Date,
    page: OrderPage,
  ): Promise<Order[]>;

  /**
   * `UPDATE … WHERE id = :id AND status IN (:from)`; null when no row matched
   * (someone else moved the order first).
   */
  abstract transition(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>>;

  /** transition() and, in the same transaction, the daily portions go back on sale. */
  abstract closeAndRestock(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>>;

  /** Pending orders whose answer time ran out, oldest first. */
  abstract findOverduePendingIds(
    now: Date,
    scope: OverdueScope,
  ): Promise<Order['id'][]>;

  abstract deleteRequestsBefore(cutoff: Date): Promise<void>;

  abstract countByStatus(
    kitchenId: Kitchen['id'],
    statuses: OrderStatus[],
  ): Promise<Partial<Record<OrderStatus, number>>>;

  /** Orders completed since `since`; revenue is the subtotal (fees are not the cook's). */
  abstract completedTotals(
    kitchenId: Kitchen['id'],
    since: Date,
  ): Promise<CompletedTotals>;

  abstract hasCompleted(kitchenId: Kitchen['id']): Promise<boolean>;

  /** As the customer, or as the cook of `kitchenId`. */
  abstract hasActiveOrders(
    customerId: User['id'],
    kitchenId: Kitchen['id'] | null,
  ): Promise<boolean>;

  /** Account deletion (KVKK): the copies of the customer's addresses go. */
  abstract clearDeliveryAddresses(customerId: User['id']): Promise<void>;
}
