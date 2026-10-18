import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  FindOptionsWhere,
  In,
  LessThan,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { SaleType } from '../../../../../catalog/catalog.enums';
import { ReadMarker } from '../../../../../trust/trust-rules';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../../../payments/domain/payment';
import { PaymentEntity } from '../../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
import { PaymentMapper } from '../../../../../payments/infrastructure/persistence/relational/mappers/payment.mapper';
import { ProductEntity } from '../../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { User } from '../../../../../users/domain/user';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { NewOrder, Order, OrderPatch } from '../../../../domain/order';
import { generateOrderCode } from '../../../../order-codes';
import { ACTIVE_STATUSES, COOK_TAB_STATUSES } from '../../../../order-status';
import { CookTab, OrderStatus } from '../../../../order.enums';
import {
  CompletedTotals,
  DuplicateOrderRequestError,
  InsufficientPortionsError,
  OrderPage,
  OrderRepository,
  OverdueScope,
  PortionTake,
} from '../../order.repository';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRequestEntity } from '../entities/order-request.entity';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemMapper } from '../mappers/order-item.mapper';
import { OrderMapper } from '../mappers/order.mapper';

/** Everything OrderMapper.toDomain reads; soft-deleted kitchens and users included. */
const RELATIONS: FindOptionsRelations<OrderEntity> = {
  items: true,
  kitchen: { owner: { photo: true } },
  customer: true,
};

const CODE_ATTEMPTS = 10;

const isUniqueViolation = (error: unknown, table: string): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string; table?: string }).code === '23505' &&
  (error.driverError as { table?: string }).table === table;

@Injectable()
export class OrderRelationalRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderRequestEntity)
    private readonly requests: Repository<OrderRequestEntity>,
  ) {}

  async place(
    input: { order: NewOrder; requestKey: string; portions: PortionTake[] },
    charge: (order: Pick<Order, 'id' | 'totalKurus'>) => Promise<NewPayment>,
  ): Promise<Order> {
    const { items, ...row } = input.order;
    let orderId: string;

    try {
      orderId = await this.orders.manager.transaction(async (manager) => {
        const id = await this.insertWithFreshCode(manager, row);

        await manager.insert(
          OrderItemEntity,
          items.map((item) => OrderItemMapper.toPersistence(item, id)),
        );
        // A concurrent request with the same key blocks here until the first
        // commits, then fails with a unique violation — before any charge.
        await manager.insert(OrderRequestEntity, {
          key: input.requestKey,
          customerId: Number(row.customerId),
          orderId: id,
        });

        // Same product order in every transaction: no lock-order deadlocks.
        const portions = [...input.portions].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        );

        for (const take of portions) {
          const { affected } = await manager
            .createQueryBuilder()
            .update(ProductEntity)
            .set({ portionsAvailable: () => '"portionsAvailable" - :quantity' })
            .where('id = :productId')
            .andWhere('"deletedAt" IS NULL')
            .andWhere('"isActive" = true')
            .andWhere('"saleType" = :saleType')
            .andWhere('"portionsAvailable" >= :quantity')
            .setParameters({
              productId: take.productId,
              quantity: take.quantity,
              saleType: SaleType.dailyPortion,
            })
            .execute();

          if (!affected) {
            throw new InsufficientPortionsError(take.productId);
          }
        }

        const payment = await charge({ id, totalKurus: row.totalKurus });
        await manager.insert(
          PaymentEntity,
          PaymentMapper.toPersistence(payment),
        );

        return id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'order_request')) {
        throw new DuplicateOrderRequestError();
      }

      throw error;
    }

    return this.findByIdOrFail(orderId);
  }

  async findIdByRequestKey(
    customerId: User['id'],
    key: string,
  ): Promise<NullableType<Order['id']>> {
    const request = await this.requests.findOne({
      where: { customerId: Number(customerId), key },
    });
    return request?.orderId ?? null;
  }

  findById(id: Order['id']): Promise<NullableType<Order>> {
    return this.findOneWhere({ id });
  }

  findForCustomer(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>> {
    return this.findOneWhere({ id, customerId: Number(customerId) });
  }

  findForKitchen(
    kitchenId: Kitchen['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>> {
    return this.findOneWhere({ id, kitchenId });
  }

  async listForCustomer(
    customerId: User['id'],
    statuses: OrderStatus[],
    page: OrderPage,
  ): Promise<Order[]> {
    const rows = await this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o."customerId" = :customerId', {
        customerId: Number(customerId),
      })
      .andWhere('o.status IN (:...statuses)', { statuses })
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .offset(page.offset)
      .limit(page.limit)
      .getRawMany<{ id: string }>();

    return this.findManyInOrder(rows.map((row) => row.id));
  }

  async listForKitchen(
    kitchenId: Kitchen['id'],
    tab: CookTab,
    dayStart: Date,
    page: OrderPage,
  ): Promise<Order[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: COOK_TAB_STATUSES[tab],
      });

    if (tab === CookTab.done) {
      qb.andWhere('COALESCE(o."completedAt", o."closedAt") >= :dayStart', {
        dayStart,
      }).orderBy('COALESCE(o."completedAt", o."closedAt")', 'DESC');
    } else {
      qb.orderBy('o.createdAt', 'ASC');
    }

    const rows = await qb
      .addOrderBy('o.id', 'ASC')
      .offset(page.offset)
      .limit(page.limit)
      .getRawMany<{ id: string }>();

    return this.findManyInOrder(rows.map((row) => row.id));
  }

  async transition(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>> {
    const { affected } = await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set(patch)
      .where('id = :id', { id })
      .andWhere('status IN (:...from)', { from })
      .execute();

    return affected ? this.findById(id) : null;
  }

  async closeAndRestock(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>> {
    const closed = await this.orders.manager.transaction(async (manager) => {
      const { affected } = await manager
        .createQueryBuilder()
        .update(OrderEntity)
        .set(patch)
        .where('id = :id', { id })
        .andWhere('status IN (:...from)', { from })
        .execute();

      if (!affected) {
        return false;
      }

      const items = await manager.find(OrderItemEntity, {
        where: { orderId: id, saleType: SaleType.dailyPortion },
        order: { productId: 'ASC' },
      });

      // A deleted product, or one switched to on-demand since, is skipped.
      for (const item of items) {
        await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ portionsAvailable: () => '"portionsAvailable" + :quantity' })
          .where('id = :productId')
          .andWhere('"deletedAt" IS NULL')
          .andWhere('"saleType" = :saleType')
          .setParameters({
            productId: item.productId,
            quantity: item.quantity,
            saleType: SaleType.dailyPortion,
          })
          .execute();
      }

      return true;
    });

    return closed ? this.findById(id) : null;
  }

  async findOverduePendingIds(
    now: Date,
    scope: OverdueScope,
  ): Promise<Order['id'][]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o.status = :pending', { pending: OrderStatus.pending })
      .andWhere('o."expiresAt" < :now', { now });

    if (scope.customerId !== undefined) {
      qb.andWhere('o."customerId" = :customerId', {
        customerId: Number(scope.customerId),
      });
    }

    if (scope.kitchenId !== undefined) {
      qb.andWhere('o."kitchenId" = :kitchenId', { kitchenId: scope.kitchenId });
    }

    const rows = await qb
      .orderBy('o.expiresAt', 'ASC')
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async deleteRequestsBefore(cutoff: Date): Promise<void> {
    await this.requests.delete({ createdAt: LessThan(cutoff) });
  }

  async countByStatus(
    kitchenId: Kitchen['id'],
    statuses: OrderStatus[],
  ): Promise<Partial<Record<OrderStatus, number>>> {
    const rows = await this.orders
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere('o.status IN (:...statuses)', { statuses })
      .groupBy('o.status')
      .getRawMany<{ status: OrderStatus; count: string }>();

    return Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    );
  }

  async completedTotals(
    kitchenId: Kitchen['id'],
    since: Date,
  ): Promise<CompletedTotals> {
    const row = await this.orders
      .createQueryBuilder('o')
      .select('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(o."subtotalKurus"), 0)', 'revenue')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere('o.status = :completed', { completed: OrderStatus.completed })
      .andWhere('o."completedAt" >= :since', { since })
      .getRawOne<{ orders: string; revenue: string }>();

    return {
      orders: Number(row?.orders ?? 0),
      revenueKurus: Number(row?.revenue ?? 0),
    };
  }

  hasCompleted(kitchenId: Kitchen['id']): Promise<boolean> {
    return this.orders.exists({
      where: { kitchenId, status: OrderStatus.completed },
    });
  }

  hasActiveOrders(
    customerId: User['id'],
    kitchenId: Kitchen['id'] | null,
  ): Promise<boolean> {
    const where: FindOptionsWhere<OrderEntity>[] = [
      { customerId: Number(customerId), status: In(ACTIVE_STATUSES) },
    ];

    if (kitchenId) {
      where.push({ kitchenId, status: In(ACTIVE_STATUSES) });
    }

    return this.orders.exists({ where });
  }

  async clearDeliveryAddresses(customerId: User['id']): Promise<void> {
    await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set({ deliveryAddress: () => 'NULL' })
      .where('"customerId" = :customerId', { customerId: Number(customerId) })
      .andWhere('"deliveryAddress" IS NOT NULL')
      .execute();
  }

  async markRead(id: Order['id'], marker: ReadMarker, at: Date): Promise<void> {
    // GREATEST: parallel reads can never move the marker backwards.
    await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set({ [marker]: () => `GREATEST(COALESCE("${marker}", :at), :at)` })
      .where('id = :id', { id })
      .setParameter('at', at)
      .execute();
  }

  /** ON CONFLICT DO NOTHING + retry: a code collision never aborts the transaction. */
  private async insertWithFreshCode(
    manager: EntityManager,
    row: Omit<NewOrder, 'items'>,
  ): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(OrderEntity)
        .values({
          ...OrderMapper.toPersistence(row),
          code: generateOrderCode(),
        })
        .orIgnore()
        .returning(['id'])
        .updateEntity(false)
        .execute();
      const [inserted] = result.raw as { id: string }[];

      if (inserted) {
        return inserted.id;
      }
    }

    throw new Error(`No free order code after ${CODE_ATTEMPTS} attempts`);
  }

  private async findOneWhere(
    where: FindOptionsWhere<OrderEntity>,
  ): Promise<NullableType<Order>> {
    const entity = await this.orders.findOne({
      where,
      relations: RELATIONS,
      withDeleted: true,
    });
    return entity ? OrderMapper.toDomain(entity) : null;
  }

  private async findByIdOrFail(id: Order['id']): Promise<Order> {
    const entity = await this.orders.findOneOrFail({
      where: { id },
      relations: RELATIONS,
      withDeleted: true,
    });
    return OrderMapper.toDomain(entity);
  }

  /** Loads with relations and keeps the order of `ids` (a page from a raw query). */
  private async findManyInOrder(ids: Order['id'][]): Promise<Order[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.orders.find({
      where: { id: In(ids) },
      relations: RELATIONS,
      withDeleted: true,
    });
    const byId = new Map(entities.map((entity) => [entity.id, entity]));

    return ids.flatMap((id) => {
      const entity = byId.get(id);
      return entity ? [OrderMapper.toDomain(entity)] : [];
    });
  }
}
