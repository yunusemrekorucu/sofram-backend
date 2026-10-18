import { SaleType } from '../catalog/catalog.enums';
import { deliveryFeeFor } from '../catalog/delivery';
import { FieldErrors } from '../catalog/field-errors';
import { LatLng, haversineKm, roundCoord, roundDistance } from '../catalog/geo';
import { openingState } from '../catalog/opening-state';
import { Category } from '../categories/domain/category';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
import { User } from '../users/domain/user';
import { Fulfillment } from './order.enums';

export type QuoteKitchen = Pick<
  Kitchen,
  | 'id'
  | 'ownerId'
  | 'latitude'
  | 'longitude'
  | 'pickupEnabled'
  | 'deliveryEnabled'
  | 'deliveryTiers'
  | 'freeDeliveryMinKurus'
  | 'hours'
  | 'isPaused'
> & { minOrderKurus: number | null };

export type QuoteProduct = Pick<
  Product,
  | 'id'
  | 'kitchenId'
  | 'priceKurus'
  | 'saleType'
  | 'prepMinutes'
  | 'portionsAvailable'
  | 'isActive'
> & { category: Pick<Category, 'isActive'> };

export type QuoteItem = { productId: string; quantity: number };

export type PricingConfig = {
  /** ORDER_SERVICE_FEE_PERCENT */
  serviceFeePercent: number;
  /** ORDER_DELIVERY_BUFFER_MINUTES */
  deliveryBufferMinutes: number;
  /** DISCOVERY_COORD_PRECISION — distance is measured from the rounded kitchen point. */
  coordPrecision: number;
};

export type QuoteInput = {
  kitchen: QuoteKitchen;
  /** The requested products that still exist (soft-deleted ones are simply missing). */
  products: QuoteProduct[];
  items: QuoteItem[];
  fulfillment: Fulfillment;
  /** The delivery address; null for pickup. */
  address: LatLng | null;
  customerId: User['id'];
  now: Date;
  config: PricingConfig;
};

export type OrderIssueKind = 'unavailable' | 'insufficient_portions';

export type OrderIssue = {
  productId: string;
  kind: OrderIssueKind;
  /** Portions left, for insufficient_portions. */
  available?: number;
};

export type OrderBlocker =
  | 'kitchen_closed'
  | 'fulfillment_unavailable'
  | 'out_of_range'
  | 'below_minimum'
  | 'own_kitchen';

export type OrderQuote = {
  subtotalKurus: number;
  deliveryFeeKurus: number;
  serviceFeeKurus: number;
  totalKurus: number;
  /** Delivery only, while a free-delivery threshold is set and not reached. */
  freeDeliveryRemainingKurus: number | null;
  /** While a minimum is set and not reached. */
  minOrderRemainingKurus: number | null;
  /** Delivery only (0.1 km), from the rounded kitchen point. */
  distanceKm: number | null;
  estimatedMinutes: number;
  issues: OrderIssue[];
  blockers: OrderBlocker[];
  canOrder: boolean;
};

const MINUTE_MS = 60_000;

/** Longest on-demand prep (daily portions are ready: 0) + the delivery buffer. */
export function estimatedMinutesFor(
  lines: { saleType: SaleType; prepMinutes: number | null }[],
  fulfillment: Fulfillment,
  deliveryBufferMinutes: number,
): number {
  const prep = Math.max(
    0,
    ...lines.map((line) =>
      line.saleType === SaleType.onDemand ? (line.prepMinutes ?? 0) : 0,
    ),
  );

  return (
    prep + (fulfillment === Fulfillment.delivery ? deliveryBufferMinutes : 0)
  );
}

export function estimatedReadyAt(acceptedAt: Date, minutes: number): Date {
  return new Date(acceptedAt.getTime() + minutes * MINUTE_MS);
}

/**
 * Prices a cart and says whether it can be ordered. Used by both
 * POST /orders/quote and POST /orders, so the two never disagree.
 */
export function quoteOrder(input: QuoteInput): OrderQuote {
  const { kitchen, fulfillment, config } = input;
  const byId = new Map(input.products.map((product) => [product.id, product]));
  const issues: OrderIssue[] = [];
  const lines: QuoteProduct[] = [];
  let subtotalKurus = 0;

  for (const item of input.items) {
    const product = byId.get(item.productId);

    if (!product) {
      issues.push({ productId: item.productId, kind: 'unavailable' });
      continue;
    }

    // Every requested item counts, sound or not; canOrder says whether it can go.
    subtotalKurus += product.priceKurus * item.quantity;

    if (
      product.kitchenId !== kitchen.id ||
      !product.isActive ||
      !product.category.isActive
    ) {
      issues.push({ productId: product.id, kind: 'unavailable' });
      continue;
    }

    lines.push(product);

    const available = product.portionsAvailable ?? 0;

    if (
      product.saleType === SaleType.dailyPortion &&
      available < item.quantity
    ) {
      issues.push({
        productId: product.id,
        kind: 'insufficient_portions',
        available,
      });
    }
  }

  const blockers: OrderBlocker[] = [];

  if (!openingState(kitchen.hours, kitchen.isPaused, input.now).isOpenNow) {
    blockers.push('kitchen_closed');
  }

  let deliveryFeeKurus = 0;
  let distanceKm: number | null = null;

  if (fulfillment === Fulfillment.pickup) {
    if (!kitchen.pickupEnabled) {
      blockers.push('fulfillment_unavailable');
    }
  } else if (!kitchen.deliveryEnabled) {
    blockers.push('fulfillment_unavailable');
  } else {
    const exactKm = input.address
      ? haversineKm(input.address, {
          latitude: roundCoord(kitchen.latitude, config.coordPrecision),
          longitude: roundCoord(kitchen.longitude, config.coordPrecision),
        })
      : Number.POSITIVE_INFINITY;
    const fee = deliveryFeeFor(kitchen.deliveryTiers, exactKm);

    distanceKm = Number.isFinite(exactKm) ? roundDistance(exactKm) : null;

    if (fee === null) {
      blockers.push('out_of_range');
    } else {
      const free =
        kitchen.freeDeliveryMinKurus !== null &&
        subtotalKurus >= kitchen.freeDeliveryMinKurus;
      deliveryFeeKurus = free ? 0 : fee;
    }
  }

  if (kitchen.minOrderKurus !== null && subtotalKurus < kitchen.minOrderKurus) {
    blockers.push('below_minimum');
  }

  if (String(kitchen.ownerId) === String(input.customerId)) {
    blockers.push('own_kitchen');
  }

  const serviceFeeKurus = Math.round(
    (subtotalKurus * config.serviceFeePercent) / 100,
  );

  return {
    subtotalKurus,
    deliveryFeeKurus,
    serviceFeeKurus,
    totalKurus: subtotalKurus + deliveryFeeKurus + serviceFeeKurus,
    freeDeliveryRemainingKurus:
      fulfillment === Fulfillment.delivery &&
      kitchen.freeDeliveryMinKurus !== null &&
      subtotalKurus < kitchen.freeDeliveryMinKurus
        ? kitchen.freeDeliveryMinKurus - subtotalKurus
        : null,
    minOrderRemainingKurus:
      kitchen.minOrderKurus !== null && subtotalKurus < kitchen.minOrderKurus
        ? kitchen.minOrderKurus - subtotalKurus
        : null,
    distanceKm,
    estimatedMinutes: estimatedMinutesFor(
      lines,
      fulfillment,
      config.deliveryBufferMinutes,
    ),
    issues,
    blockers,
    canOrder: issues.length === 0 && blockers.length === 0,
  };
}

const BLOCKER_FIELD: Record<OrderBlocker, string> = {
  kitchen_closed: 'kitchenId',
  below_minimum: 'kitchenId',
  own_kitchen: 'kitchenId',
  fulfillment_unavailable: 'fulfillment',
  out_of_range: 'addressId',
};

/** POST /orders refuses a quote that cannot be ordered with these 422 fields. */
export function quoteFieldErrors(
  quote: OrderQuote,
  items: QuoteItem[],
): FieldErrors {
  const errors: FieldErrors = {};
  const add = (field: string, message: string) => {
    errors[field] = errors[field] ? `${errors[field]}, ${message}` : message;
  };

  for (const issue of quote.issues) {
    const index = items.findIndex((item) => item.productId === issue.productId);
    add(`items.${index}.productId`, issue.kind);
  }

  for (const blocker of quote.blockers) {
    add(BLOCKER_FIELD[blocker], blocker);
  }

  return errors;
}
