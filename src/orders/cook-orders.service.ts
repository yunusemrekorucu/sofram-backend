import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { Order, OrderPatch } from './domain/order';
import { CompleteOrderDto } from './dto/cook-order-actions.dto';
import { ListCookOrdersQueryDto } from './dto/list-orders.dto';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { orderStatusConflict } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { estimatedMinutesFor, estimatedReadyAt } from './order-pricing';
import { OrderAction, canTransition } from './order-status';
import { istanbulDayStart, istanbulWeekStart } from './order-time';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';
import { cookOrderCard, cookOrderDetail } from './presenters';
import { CookOrderCard, CookOrderDetail, CookOrderSummary } from './views';

/** The cook's side: the kitchen's orders and every step after "new". */
@Injectable()
export class CookOrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly lifecycle: OrderLifecycleService,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async list(
    ownerId: User['id'],
    query: ListCookOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CookOrderCard>> {
    const kitchen = await this.kitchen(ownerId);
    const orders = await this.orderRepository.listForKitchen(
      kitchen.id,
      query.tab,
      istanbulDayStart(new Date()),
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    return infinityPagination(orders.map(cookOrderCard), {
      page: query.page,
      limit: query.limit,
    });
  }

  async summary(ownerId: User['id']): Promise<CookOrderSummary> {
    const kitchen = await this.kitchen(ownerId);
    const now = new Date();
    const [counts, today, week, hasEverCompleted] = await Promise.all([
      this.orderRepository.countByStatus(kitchen.id, [
        OrderStatus.pending,
        OrderStatus.accepted,
        OrderStatus.preparing,
        OrderStatus.ready,
        OrderStatus.onTheWay,
      ]),
      this.orderRepository.completedTotals(kitchen.id, istanbulDayStart(now)),
      this.orderRepository.completedTotals(kitchen.id, istanbulWeekStart(now)),
      this.orderRepository.hasCompleted(kitchen.id),
    ]);
    const count = (status: OrderStatus) => counts[status] ?? 0;

    return {
      counts: {
        new: count(OrderStatus.pending),
        preparing: count(OrderStatus.accepted) + count(OrderStatus.preparing),
        ready: count(OrderStatus.ready) + count(OrderStatus.onTheWay),
      },
      today,
      week,
      hasEverCompleted,
    };
  }

  async detail(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return cookOrderDetail(await this.order(ownerId, id));
  }

  /** Writes estimatedReadyAt: now + longest prep (+ buffer for delivery). */
  async accept(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);
    const now = new Date();
    const minutes = estimatedMinutesFor(
      order.items,
      order.fulfillment,
      this.configService.getOrThrow('orders.deliveryBufferMinutes', {
        infer: true,
      }),
    );

    return cookOrderDetail(
      await this.lifecycle.advance(
        order,
        'accept',
        { estimatedReadyAt: estimatedReadyAt(now, minutes) },
        now,
      ),
    );
  }

  reject(
    ownerId: User['id'],
    id: Order['id'],
    reason: OrderReason,
  ): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'reject', { reason });
  }

  start(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'start');
  }

  ready(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'ready');
  }

  dispatch(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'dispatch');
  }

  /** Pickup needs the customer's code (422 pickupCode); delivery does not. */
  async complete(
    ownerId: User['id'],
    id: Order['id'],
    dto: CompleteOrderDto,
  ): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);

    if (!canTransition(order.status, 'complete', order.fulfillment)) {
      throw orderStatusConflict();
    }

    if (order.fulfillment === Fulfillment.pickup) {
      const problem = !dto.pickupCode
        ? 'required'
        : dto.pickupCode !== order.pickupCode
          ? 'invalid'
          : null;

      if (problem) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { pickupCode: problem },
        });
      }
    }

    return cookOrderDetail(await this.lifecycle.advance(order, 'complete'));
  }

  cancel(
    ownerId: User['id'],
    id: Order['id'],
    reason: OrderReason,
  ): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'cookCancel', {
      cancelledBy: CancelledBy.cook,
      reason,
    });
  }

  private async step(
    ownerId: User['id'],
    id: Order['id'],
    action: OrderAction,
    patch: OrderPatch = {},
  ): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);
    return cookOrderDetail(await this.lifecycle.advance(order, action, patch));
  }

  /** The cook's kitchen (404 without one), with overdue orders already expired. */
  private async kitchen(ownerId: User['id']): Promise<Kitchen> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    await this.lifecycle.expireOverdue({ kitchenId: kitchen.id });
    return kitchen;
  }

  private async order(ownerId: User['id'], id: Order['id']): Promise<Order> {
    const kitchen = await this.kitchen(ownerId);
    return orNotFound(this.orderRepository.findForKitchen(kitchen.id, id));
  }
}
