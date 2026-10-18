import { Allergen } from '../catalog/catalog.enums';
import { deliveryFeeFor } from '../catalog/delivery';
import { LatLng, haversineKm, roundCoord, roundDistance } from '../catalog/geo';
import { openingState } from '../catalog/opening-state';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
import { User } from '../users/domain/user';
import {
  KitchenCard,
  KitchenDetail,
  KitchenSummary,
  MenuSection,
  ProductCard,
  ProductDetail,
} from './views';

export type ViewerContext = {
  userId: User['id'];
  allergenPreferences: Allergen[];
  point: LatLng;
  pickupRadiusKm: number;
  coordPrecision: number;
  now: Date;
  /** Of the kitchens being shown, the ones the viewer favorited. */
  favoriteKitchenIds: ReadonlySet<Kitchen['id']>;
};

/** Measured to the rounded point, so probing cannot recover the exact one. */
export function roundedDistanceKm(
  kitchen: Pick<Kitchen, 'latitude' | 'longitude'>,
  ctx: Pick<ViewerContext, 'point' | 'coordPrecision'>,
): number {
  return haversineKm(ctx.point, {
    latitude: roundCoord(kitchen.latitude, ctx.coordPrecision),
    longitude: roundCoord(kitchen.longitude, ctx.coordPrecision),
  });
}

export function kitchenSummary(
  kitchen: Kitchen,
  distanceKm: number,
  ctx: ViewerContext,
): KitchenSummary {
  const opening = openingState(kitchen.hours, kitchen.isPaused, ctx.now);

  return Object.assign(new KitchenSummary(), {
    id: kitchen.id,
    name: kitchen.name,
    district: kitchen.district,
    distanceKm: roundDistance(distanceKm),
    isOpenNow: opening.isOpenNow,
    opensAt: opening.opensAt,
    ratingAvg: kitchen.ratingAvg,
    ratingCount: kitchen.ratingCount,
  });
}

export function kitchenCard(
  kitchen: Kitchen,
  distanceKm: number,
  ctx: ViewerContext,
): KitchenCard {
  const deliveryFeeKurus = kitchen.deliveryEnabled
    ? deliveryFeeFor(kitchen.deliveryTiers, distanceKm)
    : null;

  return Object.assign(
    new KitchenCard(),
    kitchenSummary(kitchen, distanceKm, ctx),
    {
      coverPhoto: kitchen.coverPhoto,
      neighborhood: kitchen.neighborhood,
      latitude: roundCoord(kitchen.latitude, ctx.coordPrecision),
      longitude: roundCoord(kitchen.longitude, ctx.coordPrecision),
      isPaused: kitchen.isPaused,
      pickupAvailable:
        kitchen.pickupEnabled && distanceKm <= ctx.pickupRadiusKm,
      deliveryAvailable: deliveryFeeKurus !== null,
      deliveryFeeKurus,
      freeDeliveryMinKurus: kitchen.freeDeliveryMinKurus,
      isVerified: kitchen.isVerified,
      isFavorite: ctx.favoriteKitchenIds.has(kitchen.id),
    },
  );
}

export function productCard(
  product: Product,
  kitchen: Kitchen,
  distanceKm: number,
  ctx: ViewerContext,
): ProductCard {
  return Object.assign(new ProductCard(), {
    id: product.id,
    name: product.name,
    photo: product.photos[0] ?? null,
    priceKurus: product.priceKurus,
    saleType: product.saleType,
    prepMinutes: product.prepMinutes,
    portionsAvailable: product.portionsAvailable,
    allergens: product.allergens,
    dietTags: product.dietTags,
    allergenWarnings: product.allergens.filter((allergen) =>
      ctx.allergenPreferences.includes(allergen),
    ),
    category: product.category,
    kitchen: kitchenSummary(kitchen, distanceKm, ctx),
  });
}

/** `products` arrive ordered by category, then age (findListedProductsOfKitchen). */
export function kitchenDetail(
  kitchen: Kitchen,
  distanceKm: number,
  products: Product[],
  ctx: ViewerContext,
): KitchenDetail {
  const sections: MenuSection[] = [];

  for (const product of products) {
    let section = sections.find((s) => s.category.id === product.category.id);

    if (!section) {
      section = Object.assign(new MenuSection(), {
        category: product.category,
        products: [],
      });
      sections.push(section);
    }

    section.products.push(productCard(product, kitchen, distanceKm, ctx));
  }

  return Object.assign(
    new KitchenDetail(),
    kitchenCard(kitchen, distanceKm, ctx),
    {
      description: kitchen.description,
      minOrderKurus: kitchen.minOrderKurus,
      hours: kitchen.hours,
      deliveryTiers: kitchen.deliveryTiers,
      sections,
    },
  );
}

export function productDetail(
  product: Product,
  kitchen: Kitchen,
  distanceKm: number,
  ctx: ViewerContext,
): ProductDetail {
  return Object.assign(
    new ProductDetail(),
    productCard(product, kitchen, distanceKm, ctx),
    {
      description: product.description,
      photos: product.photos,
      kitchen: kitchenCard(kitchen, distanceKm, ctx),
    },
  );
}
