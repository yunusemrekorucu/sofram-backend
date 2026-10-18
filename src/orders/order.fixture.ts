import { SaleType } from '../catalog/catalog.enums';
import { FileType } from '../files/domain/file';
import { Order } from './domain/order';
import { OrderItem } from './domain/order-item';
import { Fulfillment, OrderStatus } from './order.enums';

/** Unit-test fixtures for the order specs. */
export const CREATED = new Date('2026-10-12T09:30:00Z');

export const anItem = (overrides: Partial<OrderItem> = {}): OrderItem =>
  Object.assign(new OrderItem(), {
    id: 'i1',
    productId: 'p1',
    position: 0,
    name: 'Mantı',
    unitPriceKurus: 14000,
    saleType: SaleType.onDemand,
    prepMinutes: 45,
    photo: Object.assign(new FileType(), { id: 'f1', path: '/f1.png' }),
    quantity: 2,
    note: 'Az acılı',
    ...overrides,
  });

export const anOrder = (overrides: Partial<Order> = {}): Order =>
  Object.assign(new Order(), {
    id: 'o1',
    code: 'S-7K3F',
    customerId: 9,
    kitchenId: 'k1',
    status: OrderStatus.pending,
    fulfillment: Fulfillment.pickup,
    deliveryAddress: null,
    distanceKm: null,
    note: 'Kapıda arayın',
    subtotalKurus: 28000,
    deliveryFeeKurus: 0,
    serviceFeeKurus: 1400,
    totalKurus: 29400,
    pickupCode: '0427',
    expiresAt: new Date('2026-10-12T09:33:00Z'),
    estimatedReadyAt: null,
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    onTheWayAt: null,
    completedAt: null,
    closedAt: null,
    cancelledBy: null,
    reason: null,
    items: [anItem()],
    kitchen: {
      id: 'k1',
      ownerId: 7,
      name: 'Ayşe Teyze Mutfağı',
      coverPhoto: null,
      district: 'Kadıköy',
      fullAddress: 'Caferağa Mh. Moda Cd. No:10',
      latitude: 40.98771,
      longitude: 29.02249,
      cook: { firstName: 'Ayşe', lastName: 'yılmaz', photo: null },
    },
    customer: { firstName: 'Deniz', lastName: 'İnce' },
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  });
