import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { Order } from '../../../../../orders/domain/order';
import { unreadRule } from '../../../../../trust/trust-rules';
import { MessageSide } from '../../../../../trust/trust.enums';
import { User } from '../../../../../users/domain/user';
import {
  NewOrderMessage,
  OrderMessage,
} from '../../../../domain/order-message';
import { OrderMessageRepository } from '../../order-message.repository';
import { OrderMessageEntity } from '../entities/order-message.entity';
import { OrderMessageMapper } from '../mappers/order-message.mapper';

/** unreadRule() in SQL, for message alias `m` and order alias `o`. */
const unreadFor = (viewer: MessageSide) => {
  const { senderRole, readMarker } = unreadRule(viewer);

  return {
    condition:
      `m."senderRole" = :senderRole ` +
      `AND (o."${readMarker}" IS NULL OR m."createdAt" > o."${readMarker}")`,
    senderRole,
  };
};

@Injectable()
export class OrderMessageRelationalRepository implements OrderMessageRepository {
  constructor(
    @InjectRepository(OrderMessageEntity)
    private readonly messages: Repository<OrderMessageEntity>,
  ) {}

  async create(message: NewOrderMessage): Promise<OrderMessage> {
    const entity = await this.messages.save(
      this.messages.create(OrderMessageMapper.toPersistence(message)),
    );
    return OrderMessageMapper.toDomain(entity);
  }

  async list(
    orderId: Order['id'],
    after: Date | null,
    limit: number,
  ): Promise<OrderMessage[]> {
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m."orderId" = :orderId', { orderId });

    if (after) {
      qb.andWhere('m."createdAt" > :after', { after });
    }

    const entities = await qb
      .orderBy('m.createdAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .limit(limit)
      .getMany();
    return entities.map((entity) => OrderMessageMapper.toDomain(entity));
  }

  async countUnread(
    orderIds: Order['id'][],
    viewer: MessageSide,
  ): Promise<Map<Order['id'], number>> {
    if (orderIds.length === 0) {
      return new Map();
    }

    const { condition, senderRole } = unreadFor(viewer);
    const rows = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.order', 'o')
      .select('m."orderId"', 'orderId')
      .addSelect('COUNT(*)', 'count')
      .where('m."orderId" IN (:...orderIds)', { orderIds })
      .andWhere(condition, { senderRole })
      .groupBy('m."orderId"')
      .getRawMany<{ orderId: string; count: string }>();

    return new Map(rows.map((row) => [row.orderId, Number(row.count)]));
  }

  async removeAllBySender(senderId: User['id']): Promise<void> {
    await this.messages.delete({ senderId: Number(senderId) });
  }

  async countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number> {
    const { condition, senderRole } = unreadFor(MessageSide.cook);
    const row = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.order', 'o')
      .select('COUNT(*)', 'count')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere(condition, { senderRole })
      .getRawOne<{ count: string }>();

    return Number(row?.count ?? 0);
  }
}
