import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { NewOrderItem } from '../../../../domain/order';
import { OrderItem } from '../../../../domain/order-item';
import { OrderItemEntity } from '../entities/order-item.entity';

export class OrderItemMapper {
  static toDomain(raw: OrderItemEntity): OrderItem {
    return Object.assign(new OrderItem(), {
      id: raw.id,
      productId: raw.productId,
      position: raw.position,
      name: raw.name,
      unitPriceKurus: raw.unitPriceKurus,
      saleType: raw.saleType,
      prepMinutes: raw.prepMinutes,
      photo: raw.photo ? toFileType(raw.photo) : null,
      quantity: raw.quantity,
      note: raw.note,
    });
  }

  static toPersistence(item: NewOrderItem, orderId: string): OrderItemEntity {
    return Object.assign(new OrderItemEntity(), {
      ...item,
      orderId,
      photo: item.photo ? toSnapshot(item.photo) : null,
    });
  }
}
