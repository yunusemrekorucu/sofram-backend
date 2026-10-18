import { PaymentStatus } from '../payments/domain/payment';
import { Order, PersonName } from './domain/order';
import { OrderItem } from './domain/order-item';
import { OrderQuote, estimatedMinutesFor } from './order-pricing';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  CookOrderCard,
  CookOrderDetail,
  CustomerOrderCard,
  CustomerOrderDetail,
  KitchenAddressView,
  OrderItemView,
  OrderQuoteView,
} from './views';

/** "Ayşe Y." — the other side never sees a full name (or a phone number). */
export function shortName(person: PersonName): string | null {
  if (!person.firstName) {
    return null;
  }

  const initial = person.lastName?.charAt(0).toLocaleUpperCase('tr-TR');
  return initial ? `${person.firstName} ${initial}.` : person.firstName;
}

/** Faz 2 §1: the exact kitchen address opens for a confirmed pickup, and closes again. */
const KITCHEN_ADDRESS_STATUSES = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

export function kitchenAddressFor(order: Order): KitchenAddressView | null {
  if (
    order.fulfillment !== Fulfillment.pickup ||
    !KITCHEN_ADDRESS_STATUSES.includes(order.status)
  ) {
    return null;
  }

  return Object.assign(new KitchenAddressView(), {
    fullAddress: order.kitchen.fullAddress,
    latitude: order.kitchen.latitude,
    longitude: order.kitchen.longitude,
  });
}

export const quoteView = (quote: OrderQuote): OrderQuoteView =>
  Object.assign(new OrderQuoteView(), quote);

export const itemView = (item: OrderItem): OrderItemView =>
  Object.assign(new OrderItemView(), {
    id: item.id,
    productId: item.productId,
    name: item.name,
    unitPriceKurus: item.unitPriceKurus,
    saleType: item.saleType,
    prepMinutes: item.prepMinutes,
    photo: item.photo,
    quantity: item.quantity,
    note: item.note,
  });

/** The step indicator's timestamps; shared with the cook's detail. */
export const timeline = (order: Order) => ({
  createdAt: order.createdAt,
  expiresAt: order.expiresAt,
  estimatedReadyAt: order.estimatedReadyAt,
  acceptedAt: order.acceptedAt,
  preparingAt: order.preparingAt,
  readyAt: order.readyAt,
  onTheWayAt: order.onTheWayAt,
  completedAt: order.completedAt,
  closedAt: order.closedAt,
});

export function customerOrderCard(order: Order): CustomerOrderCard {
  return Object.assign(new CustomerOrderCard(), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    kitchen: {
      id: order.kitchen.id,
      name: order.kitchen.name,
      coverPhoto: order.kitchen.coverPhoto,
    },
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
    })),
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

export function customerOrderDetail(
  order: Order,
  paymentStatus: PaymentStatus | null,
  deliveryBufferMinutes: number,
): CustomerOrderDetail {
  return Object.assign(new CustomerOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    items: order.items.map(itemView),
    note: order.note,
    subtotalKurus: order.subtotalKurus,
    deliveryFeeKurus: order.deliveryFeeKurus,
    serviceFeeKurus: order.serviceFeeKurus,
    totalKurus: order.totalKurus,
    distanceKm: order.distanceKm,
    deliveryAddress: order.deliveryAddress,
    pickupCode: order.pickupCode,
    kitchen: {
      id: order.kitchen.id,
      name: order.kitchen.name,
      coverPhoto: order.kitchen.coverPhoto,
      district: order.kitchen.district,
      cookName: shortName(order.kitchen.cook),
      cookPhoto: order.kitchen.cook.photo,
    },
    kitchenAddress: kitchenAddressFor(order),
    estimatedMinutes:
      order.status === OrderStatus.pending
        ? estimatedMinutesFor(
            order.items,
            order.fulfillment,
            deliveryBufferMinutes,
          )
        : null,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
    payment: paymentStatus ? { status: paymentStatus } : null,
  });
}

export function cookOrderCard(order: Order): CookOrderCard {
  return Object.assign(new CookOrderCard(), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    distanceKm: order.distanceKm,
    customerName: shortName(order.customer),
    items: order.items.map(itemView),
    note: order.note,
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

export function cookOrderDetail(order: Order): CookOrderDetail {
  return Object.assign(new CookOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    distanceKm: order.distanceKm,
    customerName: shortName(order.customer),
    deliveryAddress: order.deliveryAddress,
    items: order.items.map(itemView),
    note: order.note,
    subtotalKurus: order.subtotalKurus,
    deliveryFeeKurus: order.deliveryFeeKurus,
    serviceFeeKurus: order.serviceFeeKurus,
    totalKurus: order.totalKurus,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
  });
}
