import { SaleType } from '../catalog/catalog.enums';
import { isKitchenReachable, isProductListed } from './visibility';

const kitchen = {
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryRadiusKm: 3,
};

describe('isKitchenReachable', () => {
  it('should reach by delivery inside the radius, inclusive', () => {
    expect(isKitchenReachable({ ...kitchen, pickupEnabled: false }, 3, 5)).toBe(
      true,
    );
    expect(
      isKitchenReachable({ ...kitchen, pickupEnabled: false }, 3.1, 5),
    ).toBe(false);
  });

  it('should reach by pickup inside the platform radius', () => {
    expect(
      isKitchenReachable(
        { ...kitchen, deliveryEnabled: false, deliveryRadiusKm: null },
        4.9,
        5,
      ),
    ).toBe(true);
    expect(isKitchenReachable(kitchen, 5.1, 5)).toBe(false);
  });

  it('should ignore a stale radius while delivery is off', () => {
    expect(
      isKitchenReachable(
        { pickupEnabled: false, deliveryEnabled: false, deliveryRadiusKm: 10 },
        1,
        5,
      ),
    ).toBe(false);
  });
});

describe('isProductListed', () => {
  const product = {
    isActive: true,
    category: { isActive: true },
    saleType: SaleType.onDemand,
    portionsAvailable: null,
  };

  it('should list an active on-demand product', () => {
    expect(isProductListed(product)).toBe(true);
  });

  it('should hide inactive products and inactive categories', () => {
    expect(isProductListed({ ...product, isActive: false })).toBe(false);
    expect(isProductListed({ ...product, category: { isActive: false } })).toBe(
      false,
    );
  });

  it('should hide sold-out daily portions', () => {
    const daily = { ...product, saleType: SaleType.dailyPortion };
    expect(isProductListed({ ...daily, portionsAvailable: 0 })).toBe(false);
    expect(isProductListed({ ...daily, portionsAvailable: 1 })).toBe(true);
  });
});
