import { Allergen, SaleType } from '../catalog/catalog.enums';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
import {
  ViewerContext,
  kitchenCard,
  kitchenDetail,
  productCard,
  productDetail,
} from './presenters';

const NOW = new Date('2026-10-12T09:30:00Z');

const ctx: ViewerContext = {
  userId: 9,
  allergenPreferences: [Allergen.milk],
  point: { latitude: 40.99, longitude: 29.02 },
  pickupRadiusKm: 5,
  coordPrecision: 3,
  now: NOW,
};

const kitchen = Object.assign(new Kitchen(), {
  id: 'k1',
  ownerId: 7,
  name: 'Ayşe Teyze Mutfağı',
  description: 'Ev yemekleri',
  coverPhoto: null,
  fullAddress: 'Caferağa Mh. Moda Cd. No:1',
  district: 'Kadıköy',
  neighborhood: 'Caferağa',
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 0 },
    { upToKm: 6, feeKurus: 2500 },
  ],
  deliveryRadiusKm: 6,
  freeDeliveryMinKurus: 30000,
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
  isVerified: false,
});

const MAIN = Object.assign(new Category(), {
  id: 'c1',
  slug: 'main-dish',
  isActive: true,
});
const SOUP = Object.assign(new Category(), {
  id: 'c2',
  slug: 'soup',
  isActive: true,
});
const photo = (id: string) =>
  Object.assign(new FileType(), { id, path: `/${id}.png` });

const product = (overrides: Partial<Product> = {}) =>
  Object.assign(new Product(), {
    id: 'p1',
    kitchenId: 'k1',
    category: MAIN,
    name: 'Mantı',
    description: 'Yoğurtlu',
    priceKurus: 14000,
    saleType: SaleType.onDemand,
    prepMinutes: 45,
    portionsAvailable: null,
    allergens: [Allergen.milk, Allergen.gluten],
    dietTags: [],
    photos: [photo('f2'), photo('f1')],
    isActive: true,
    ...overrides,
  });

describe('kitchenCard', () => {
  it('should round coordinates and distance and price delivery by tier', () => {
    expect(kitchenCard(kitchen, 2.46, ctx)).toMatchObject({
      id: 'k1',
      latitude: 40.988,
      longitude: 29.022,
      distanceKm: 2.5,
      isOpenNow: true,
      opensAt: null,
      pickupAvailable: true,
      deliveryAvailable: true,
      deliveryFeeKurus: 2500,
      freeDeliveryMinKurus: 30000,
    });
  });

  it('should drop delivery beyond the last tier and pickup beyond the platform radius', () => {
    expect(kitchenCard(kitchen, 6.5, ctx)).toMatchObject({
      pickupAvailable: false,
      deliveryAvailable: false,
      deliveryFeeKurus: null,
    });
  });

  it('should not leak the exact address', () => {
    const card = kitchenCard(kitchen, 1, ctx);
    expect(card).not.toHaveProperty('fullAddress');
    expect(card).not.toHaveProperty('ownerId');
  });
});

describe('productCard', () => {
  it('should use the first photo and warn about the viewer’s allergens', () => {
    expect(productCard(product(), kitchen, 1, ctx)).toMatchObject({
      photo: { id: 'f2' },
      allergenWarnings: [Allergen.milk],
      kitchen: { id: 'k1', distanceKm: 1, isOpenNow: true },
    });
  });

  it('should have no photo without photos', () => {
    expect(
      productCard(product({ photos: [] }), kitchen, 1, ctx).photo,
    ).toBeNull();
  });
});

describe('kitchenDetail', () => {
  it('should group products by category in the given order', () => {
    const detail = kitchenDetail(
      kitchen,
      1,
      [product(), product({ id: 'p2', category: SOUP }), product({ id: 'p3' })],
      ctx,
    );

    expect(detail.sections.map((s) => s.category.id)).toEqual(['c1', 'c2']);
    expect(detail.sections[0].products.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(detail).toMatchObject({
      description: 'Ev yemekleri',
      hours: kitchen.hours,
    });
  });
});

describe('productDetail', () => {
  it('should carry every photo and the full kitchen card', () => {
    const detail = productDetail(product(), kitchen, 1, ctx);

    expect(detail.photos.map((p) => p.id)).toEqual(['f2', 'f1']);
    expect(detail.description).toBe('Yoğurtlu');
    expect(detail.kitchen).toMatchObject({ id: 'k1', deliveryFeeKurus: 0 });
  });
});
