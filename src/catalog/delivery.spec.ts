import { deliveryFeeFor } from './delivery';

const TIERS = [
  { upToKm: 1, feeKurus: 0 },
  { upToKm: 3, feeKurus: 2000 },
  { upToKm: 5, feeKurus: 3500 },
];

describe('deliveryFeeFor', () => {
  it('should charge the first tier that reaches the distance', () => {
    expect(deliveryFeeFor(TIERS, 0.4)).toBe(0);
    expect(deliveryFeeFor(TIERS, 2.5)).toBe(2000);
  });

  it('should include the tier boundary', () => {
    expect(deliveryFeeFor(TIERS, 1)).toBe(0);
    expect(deliveryFeeFor(TIERS, 5)).toBe(3500);
  });

  it('should be null beyond the last tier or without tiers', () => {
    expect(deliveryFeeFor(TIERS, 5.01)).toBeNull();
    expect(deliveryFeeFor([], 0)).toBeNull();
  });
});
