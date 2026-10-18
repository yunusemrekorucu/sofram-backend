import { SaleType } from '../catalog/catalog.enums';
import { Fulfillment } from './order.enums';
import {
  QuoteInput,
  QuoteKitchen,
  QuoteProduct,
  estimatedMinutesFor,
  estimatedReadyAt,
  quoteFieldErrors,
  quoteOrder,
} from './order-pricing';

// 2026-10-12 is a Monday; 09:30 UTC is 12:30 in Istanbul.
const NOW = new Date('2026-10-12T09:30:00Z');
const KM_PER_DEGREE = (Math.PI / 180) * 6371;

const kitchen: QuoteKitchen = {
  id: 'k1',
  ownerId: 7,
  // Rounded to 3 decimals: 40.988, 29.022.
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 1500 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  freeDeliveryMinKurus: 30000,
  minOrderKurus: null,
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
};

/** `km` north of the rounded kitchen point. */
const north = (km: number) => ({
  latitude: 40.988 + km / KM_PER_DEGREE,
  longitude: 29.022,
});

const product = (overrides: Partial<QuoteProduct> = {}): QuoteProduct => ({
  id: 'manti',
  kitchenId: 'k1',
  priceKurus: 14000,
  saleType: SaleType.onDemand,
  prepMinutes: 45,
  portionsAvailable: null,
  isActive: true,
  category: { isActive: true },
  ...overrides,
});

const sutlac = product({
  id: 'sutlac',
  priceKurus: 6500,
  saleType: SaleType.dailyPortion,
  prepMinutes: null,
  portionsAvailable: 8,
});

const input = (overrides: Partial<QuoteInput> = {}): QuoteInput => ({
  kitchen,
  products: [product(), sutlac],
  items: [
    { productId: 'manti', quantity: 2 },
    { productId: 'sutlac', quantity: 1 },
  ],
  fulfillment: Fulfillment.pickup,
  address: null,
  customerId: 9,
  now: NOW,
  config: {
    serviceFeePercent: 5,
    deliveryBufferMinutes: 15,
    coordPrecision: 3,
  },
  ...overrides,
});

describe('quoteOrder', () => {
  it('should price a pickup order', () => {
    expect(quoteOrder(input())).toEqual({
      subtotalKurus: 34500,
      deliveryFeeKurus: 0,
      serviceFeeKurus: 1725,
      totalKurus: 36225,
      freeDeliveryRemainingKurus: null,
      minOrderRemainingKurus: null,
      distanceKm: null,
      estimatedMinutes: 45,
      issues: [],
      blockers: [],
      canOrder: true,
    });
  });

  it('should charge the delivery tier below the free-delivery threshold', () => {
    const quote = quoteOrder(
      input({
        fulfillment: Fulfillment.delivery,
        address: north(3),
        items: [{ productId: 'manti', quantity: 1 }],
      }),
    );

    expect(quote).toMatchObject({
      subtotalKurus: 14000,
      deliveryFeeKurus: 2500,
      serviceFeeKurus: 700,
      totalKurus: 17200,
      freeDeliveryRemainingKurus: 16000,
      distanceKm: 3,
      estimatedMinutes: 60,
      canOrder: true,
    });
  });

  it('should deliver for free from the threshold on (≥)', () => {
    const at = (priceKurus: number) =>
      quoteOrder(
        input({
          fulfillment: Fulfillment.delivery,
          address: north(1),
          products: [product({ priceKurus })],
          items: [{ productId: 'manti', quantity: 3 }],
        }),
      );

    expect(at(10000)).toMatchObject({
      subtotalKurus: 30000,
      deliveryFeeKurus: 0,
      freeDeliveryRemainingKurus: null,
    });
    expect(at(9999)).toMatchObject({
      subtotalKurus: 29997,
      deliveryFeeKurus: 1500,
      freeDeliveryRemainingKurus: 3,
    });
  });

  it('should round the service fee to the nearest kuruş', () => {
    const fee = (priceKurus: number) =>
      quoteOrder(
        input({
          products: [product({ priceKurus })],
          items: [{ productId: 'manti', quantity: 1 }],
        }),
      ).serviceFeeKurus;

    expect(fee(14009)).toBe(700); // 700.45
    expect(fee(14010)).toBe(701); // 700.5
    expect(fee(14030)).toBe(702); // 701.5
  });

  it('should block an address beyond the last tier', () => {
    expect(
      quoteOrder(
        input({ fulfillment: Fulfillment.delivery, address: north(6) }),
      ),
    ).toMatchObject({
      deliveryFeeKurus: 0,
      distanceKm: 6,
      blockers: ['out_of_range'],
      canOrder: false,
    });
  });

  it('should block a fulfillment the kitchen does not offer', () => {
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, pickupEnabled: false } }))
        .blockers,
    ).toEqual(['fulfillment_unavailable']);
    expect(
      quoteOrder(
        input({
          kitchen: { ...kitchen, deliveryEnabled: false },
          fulfillment: Fulfillment.delivery,
          address: north(1),
        }),
      ),
    ).toMatchObject({
      blockers: ['fulfillment_unavailable'],
      distanceKm: null,
    });
  });

  it('should block a closed or paused kitchen', () => {
    expect(
      quoteOrder(input({ now: new Date('2026-10-12T18:00:00Z') })).blockers,
    ).toEqual(['kitchen_closed']);
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, isPaused: true } })).blockers,
    ).toEqual(['kitchen_closed']);
  });

  it('should block an order below the kitchen minimum', () => {
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, minOrderKurus: 40000 } })),
    ).toMatchObject({
      blockers: ['below_minimum'],
      minOrderRemainingKurus: 5500,
    });
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, minOrderKurus: 34500 } })),
    ).toMatchObject({ blockers: [], minOrderRemainingKurus: null });
  });

  it('should block ordering from one’s own kitchen', () => {
    expect(quoteOrder(input({ customerId: '7' })).blockers).toEqual([
      'own_kitchen',
    ]);
  });

  it('should report too few daily portions with what is left', () => {
    const quote = quoteOrder(
      input({ items: [{ productId: 'sutlac', quantity: 9 }] }),
    );

    expect(quote.issues).toEqual([
      { productId: 'sutlac', kind: 'insufficient_portions', available: 8 },
    ]);
    expect(quote.canOrder).toBe(false);
  });

  it('should report missing, inactive and foreign products as unavailable but still price them', () => {
    const quote = quoteOrder(
      input({
        products: [
          product({ id: 'off', isActive: false }),
          product({ id: 'foreign', kitchenId: 'k2' }),
          product({ id: 'hidden', category: { isActive: false } }),
        ],
        items: [
          { productId: 'gone', quantity: 1 },
          { productId: 'off', quantity: 1 },
          { productId: 'foreign', quantity: 1 },
          { productId: 'hidden', quantity: 1 },
        ],
      }),
    );

    expect(quote.issues).toEqual([
      { productId: 'gone', kind: 'unavailable' },
      { productId: 'off', kind: 'unavailable' },
      { productId: 'foreign', kind: 'unavailable' },
      { productId: 'hidden', kind: 'unavailable' },
    ]);
    expect(quote.subtotalKurus).toBe(42000);
    expect(quote.estimatedMinutes).toBe(0);
  });
});

describe('estimatedMinutesFor', () => {
  it('should take the longest on-demand prep and treat daily portions as ready', () => {
    const lines = [
      { saleType: SaleType.onDemand, prepMinutes: 20 },
      { saleType: SaleType.onDemand, prepMinutes: 45 },
      { saleType: SaleType.dailyPortion, prepMinutes: null },
    ];

    expect(estimatedMinutesFor(lines, Fulfillment.pickup, 15)).toBe(45);
    expect(estimatedMinutesFor(lines, Fulfillment.delivery, 15)).toBe(60);
    expect(estimatedMinutesFor([], Fulfillment.pickup, 15)).toBe(0);
  });
});

describe('estimatedReadyAt', () => {
  it('should add the minutes to the acceptance time', () => {
    expect(estimatedReadyAt(NOW, 60)).toEqual(new Date('2026-10-12T10:30:00Z'));
  });
});

describe('quoteFieldErrors', () => {
  it('should point issues at their item and blockers at the request field', () => {
    const quote = quoteOrder(
      input({
        kitchen: { ...kitchen, isPaused: true, minOrderKurus: 100000 },
        fulfillment: Fulfillment.delivery,
        address: north(6),
        items: [
          { productId: 'manti', quantity: 1 },
          { productId: 'sutlac', quantity: 9 },
        ],
      }),
    );

    expect(
      quoteFieldErrors(quote, [
        { productId: 'manti', quantity: 1 },
        { productId: 'sutlac', quantity: 9 },
      ]),
    ).toEqual({
      'items.1.productId': 'insufficient_portions',
      kitchenId: 'kitchen_closed, below_minimum',
      addressId: 'out_of_range',
    });
  });
});
