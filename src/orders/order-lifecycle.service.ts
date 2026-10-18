import { Injectable } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { Order, OrderPatch } from './domain/order';
import {
  OrderRepository,
  OverdueScope,
} from './infrastructure/persistence/order.repository';
import { orderStatusConflict } from './order-errors';
import {
  OrderAction,
  ROLLBACK_STATUSES,
  STAMP_FOR,
  transitionFor,
} from './order-status';
import { CancelledBy, OrderStatus } from './order.enums';

/**
 * Every status change goes through here: a guarded UPDATE, the timestamp of
 * the new status, and — when an order is rejected, cancelled or expires — the
 * portions back on sale and the money back to the customer.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly paymentsService: PaymentsService,
  ) {}

  /** Applies `action` or throws 409 orderStatusConflict. */
  async advance(
    order: Order,
    action: OrderAction,
    patch: OrderPatch = {},
    now: Date = new Date(),
  ): Promise<Order> {
    const transition = transitionFor(action, order.fulfillment);

    if (!transition || !transition.from.includes(order.status)) {
      throw orderStatusConflict();
    }

    const stamp = STAMP_FOR[transition.to];
    const changes: OrderPatch = {
      ...patch,
      status: transition.to,
      ...(stamp ? { [stamp]: now } : {}),
    };

    if (!ROLLBACK_STATUSES.includes(transition.to)) {
      const moved = await this.orderRepository.transition(
        order.id,
        transition.from,
        changes,
      );

      if (!moved) {
        throw orderStatusConflict();
      }

      return moved;
    }

    const closed = await this.orderRepository.closeAndRestock(
      order.id,
      transition.from,
      changes,
    );

    if (!closed) {
      throw orderStatusConflict();
    }

    await this.paymentsService.refund(order.id);
    return closed;
  }

  /**
   * Expires pending orders nobody answered in time — all of them (the
   * scheduled sweep) or one customer's / kitchen's (before a read).
   */
  async expireOverdue(
    scope: OverdueScope = {},
    now: Date = new Date(),
  ): Promise<number> {
    const ids = await this.orderRepository.findOverduePendingIds(now, scope);
    let expired = 0;

    for (const id of ids) {
      const closed = await this.orderRepository.closeAndRestock(
        id,
        [OrderStatus.pending],
        {
          status: OrderStatus.expired,
          closedAt: now,
          cancelledBy: CancelledBy.system,
          reason: null,
        },
      );

      // Someone answered or cancelled it in the meantime.
      if (closed) {
        expired++;
        await this.paymentsService.refund(id);
      }
    }

    return expired;
  }
}
