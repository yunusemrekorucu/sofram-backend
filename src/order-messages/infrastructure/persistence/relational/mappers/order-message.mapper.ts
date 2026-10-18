import {
  NewOrderMessage,
  OrderMessage,
} from '../../../../domain/order-message';
import { OrderMessageEntity } from '../entities/order-message.entity';

export class OrderMessageMapper {
  static toDomain(raw: OrderMessageEntity): OrderMessage {
    return Object.assign(new OrderMessage(), {
      id: raw.id,
      orderId: raw.orderId,
      senderId: raw.senderId,
      senderRole: raw.senderRole,
      body: raw.body,
      createdAt: raw.createdAt,
    });
  }

  static toPersistence(message: NewOrderMessage): OrderMessageEntity {
    return Object.assign(new OrderMessageEntity(), {
      ...message,
      senderId: Number(message.senderId),
    });
  }
}
