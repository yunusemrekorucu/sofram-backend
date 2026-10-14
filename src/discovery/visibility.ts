import { SaleType } from '../catalog/catalog.enums';
import { Category } from '../categories/domain/category';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';

/** Mirrors `whereReachable` in DiscoveryRepository — keep them in step. */
export function isKitchenReachable(
  kitchen: Pick<
    Kitchen,
    'pickupEnabled' | 'deliveryEnabled' | 'deliveryRadiusKm'
  >,
  distanceKm: number,
  pickupRadiusKm: number,
): boolean {
  const byDelivery =
    kitchen.deliveryEnabled &&
    kitchen.deliveryRadiusKm !== null &&
    distanceKm <= kitchen.deliveryRadiusKm;
  const byPickup = kitchen.pickupEnabled && distanceKm <= pickupRadiusKm;

  return byDelivery || byPickup;
}

/** Mirrors `listed()` in DiscoveryRepository — keep them in step. */
export function isProductListed(
  product: Pick<Product, 'isActive' | 'saleType' | 'portionsAvailable'> & {
    category: Pick<Category, 'isActive'>;
  },
): boolean {
  return (
    product.isActive &&
    product.category.isActive &&
    (product.saleType === SaleType.onDemand ||
      (product.portionsAvailable ?? 0) > 0)
  );
}
