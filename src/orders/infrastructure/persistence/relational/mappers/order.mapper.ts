import { toFileType } from '../../../../../catalog/file-snapshot';
import { FileMapper } from '../../../../../files/infrastructure/persistence/relational/mappers/file.mapper';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { NewOrder, Order } from '../../../../domain/order';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemMapper } from './order-item.mapper';

export class OrderMapper {
  /** Expects items, kitchen (+ owner) and customer joined — OrderRelationalRepository always does. */
  static toDomain(raw: OrderEntity): Order {
    const kitchen = raw.kitchen as KitchenEntity;
    const cook = kitchen.owner;

    return Object.assign(new Order(), {
      id: raw.id,
      code: raw.code,
      customerId: raw.customerId,
      kitchenId: raw.kitchenId,
      status: raw.status,
      fulfillment: raw.fulfillment,
      deliveryAddress: raw.deliveryAddress,
      distanceKm: raw.distanceKm,
      note: raw.note,
      subtotalKurus: raw.subtotalKurus,
      deliveryFeeKurus: raw.deliveryFeeKurus,
      serviceFeeKurus: raw.serviceFeeKurus,
      totalKurus: raw.totalKurus,
      pickupCode: raw.pickupCode,
      expiresAt: raw.expiresAt,
      estimatedReadyAt: raw.estimatedReadyAt,
      acceptedAt: raw.acceptedAt,
      preparingAt: raw.preparingAt,
      readyAt: raw.readyAt,
      onTheWayAt: raw.onTheWayAt,
      completedAt: raw.completedAt,
      closedAt: raw.closedAt,
      cancelledBy: raw.cancelledBy,
      reason: raw.reason,
      customerLastReadAt: raw.customerLastReadAt,
      cookLastReadAt: raw.cookLastReadAt,
      items: (raw.items ?? [])
        .map((item) => OrderItemMapper.toDomain(item))
        .sort((a, b) => a.position - b.position),
      kitchen: {
        id: kitchen.id,
        ownerId: kitchen.ownerId,
        name: kitchen.name,
        coverPhoto: kitchen.coverPhoto ? toFileType(kitchen.coverPhoto) : null,
        district: kitchen.district,
        fullAddress: kitchen.fullAddress,
        latitude: kitchen.latitude,
        longitude: kitchen.longitude,
        cook: {
          firstName: cook?.firstName ?? null,
          lastName: cook?.lastName ?? null,
          photo: cook?.photo ? FileMapper.toDomain(cook.photo) : null,
        },
      },
      customer: {
        firstName: raw.customer?.firstName ?? null,
        lastName: raw.customer?.lastName ?? null,
      },
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  /** The order row; items are inserted separately. */
  static toPersistence(order: Omit<NewOrder, 'items'>): OrderEntity {
    return Object.assign(new OrderEntity(), order, {
      customerId: Number(order.customerId),
    });
  }
}
