import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleType } from '../catalog/catalog.enums';
import { FileType } from '../files/domain/file';
import { PaymentStatus } from '../payments/domain/payment';
import { OrderBlocker, OrderIssueKind } from './order-pricing';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';

export class OrderIssueView {
  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ enum: ['unavailable', 'insufficient_portions'] })
  kind: OrderIssueKind;

  @ApiPropertyOptional({ type: Number, description: 'Kalan porsiyon' })
  available?: number;
}

/** POST /orders/quote; also `data.quote` of a 409 orderTotalChanged. */
export class OrderQuoteView {
  @ApiProperty({ type: Number, description: 'kuruş' })
  subtotalKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  deliveryFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  serviceFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  freeDeliveryRemainingKurus: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  minOrderRemainingKurus: number | null;

  @ApiProperty({ type: Number, nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: Number })
  estimatedMinutes: number;

  @ApiProperty({ type: () => OrderIssueView, isArray: true })
  issues: OrderIssueView[];

  @ApiProperty({
    enum: [
      'kitchen_closed',
      'fulfillment_unavailable',
      'out_of_range',
      'below_minimum',
      'own_kitchen',
    ],
    isArray: true,
  })
  blockers: OrderBlocker[];

  @ApiProperty({ type: Boolean })
  canOrder: boolean;
}

export class DeliveryAddressView {
  @ApiProperty({ type: String })
  fullAddress: string;

  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: String })
  neighborhood: string;

  @ApiProperty({ type: String, nullable: true })
  buildingNo: string | null;

  @ApiProperty({ type: String, nullable: true })
  floor: string | null;

  @ApiProperty({ type: String, nullable: true })
  apartmentNo: string | null;

  @ApiProperty({ type: String, nullable: true })
  directions: string | null;

  @ApiProperty({ type: Number })
  latitude: number;

  @ApiProperty({ type: Number })
  longitude: number;
}

export class OrderItemView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Number, description: 'kuruş' })
  unitPriceKurus: number;

  @ApiProperty({ enum: SaleType })
  saleType: SaleType;

  @ApiProperty({ type: Number, nullable: true })
  prepMinutes: number | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  photo: FileType | null;

  @ApiProperty({ type: Number })
  quantity: number;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;
}

export class OrderItemSummary {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Number })
  quantity: number;
}

export class OrderKitchenSummary {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: () => FileType, nullable: true })
  coverPhoto: FileType | null;
}

export class OrderKitchenCard extends OrderKitchenSummary {
  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: String, nullable: true, description: 'Ad S.' })
  cookName: string | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  cookPhoto: FileType | null;
}

/** The kitchen's exact address: pickup orders between accepted and ready only. */
export class KitchenAddressView {
  @ApiProperty({ type: String })
  fullAddress: string;

  @ApiProperty({ type: Number })
  latitude: number;

  @ApiProperty({ type: Number })
  longitude: number;
}

export class OrderPaymentView {
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;
}

/** GET /orders */
export class CustomerOrderCard {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'S-7K3F' })
  code: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: Fulfillment })
  fulfillment: Fulfillment;

  @ApiProperty({ type: () => OrderKitchenSummary })
  kitchen: OrderKitchenSummary;

  @ApiProperty({ type: () => OrderItemSummary, isArray: true })
  items: OrderItemSummary[];

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;
}

/** Shared by the customer's and the cook's detail. */
export class OrderTimeline {
  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  acceptedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  preparingAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  readyAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  onTheWayAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  closedAt: Date | null;
}

/** GET /orders/:id */
export class CustomerOrderDetail extends OrderTimeline {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: Fulfillment })
  fulfillment: Fulfillment;

  @ApiProperty({ type: () => OrderItemView, isArray: true })
  items: OrderItemView[];

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  subtotalKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  deliveryFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  serviceFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty({ type: Number, nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: () => DeliveryAddressView, nullable: true })
  deliveryAddress: DeliveryAddressView | null;

  @ApiProperty({ type: String, nullable: true, description: 'Yalnız gel-al' })
  pickupCode: string | null;

  @ApiProperty({ type: () => OrderKitchenCard })
  kitchen: OrderKitchenCard;

  @ApiProperty({ type: () => KitchenAddressView, nullable: true })
  kitchenAddress: KitchenAddressView | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Kabulden önce: şimdi kabul edilse kaç dakikada hazır',
  })
  estimatedMinutes: number | null;

  @ApiProperty({ enum: OrderReason, nullable: true })
  reason: OrderReason | null;

  @ApiProperty({ enum: CancelledBy, nullable: true })
  cancelledBy: CancelledBy | null;

  @ApiProperty({ type: () => OrderPaymentView, nullable: true })
  payment: OrderPaymentView | null;
}
