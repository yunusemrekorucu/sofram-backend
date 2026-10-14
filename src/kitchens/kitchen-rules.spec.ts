import { deliveryRadiusOf, kitchenRuleErrors } from './kitchen-rules';

const valid = {
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 0 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  hours: [
    { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
    { dayOfWeek: 1, opensAt: '14:00', closesAt: '20:00' },
    { dayOfWeek: 2, opensAt: '11:00', closesAt: '20:00' },
  ],
};

describe('kitchenRuleErrors', () => {
  it('should accept a valid kitchen, including back-to-back slots', () => {
    expect(kitchenRuleErrors(valid)).toEqual({});
  });

  it('should require pickup or delivery', () => {
    expect(
      kitchenRuleErrors({
        ...valid,
        pickupEnabled: false,
        deliveryEnabled: false,
      }),
    ).toEqual({ deliveryEnabled: 'pickupOrDeliveryRequired' });
  });

  it('should require tiers while delivery is on, not while it is off', () => {
    expect(kitchenRuleErrors({ ...valid, deliveryTiers: [] })).toEqual({
      deliveryTiers: 'required',
    });
    expect(
      kitchenRuleErrors({
        ...valid,
        deliveryEnabled: false,
        deliveryTiers: [],
      }),
    ).toEqual({});
  });

  it('should require strictly increasing tiers', () => {
    expect(
      kitchenRuleErrors({
        ...valid,
        deliveryTiers: [
          { upToKm: 3, feeKurus: 0 },
          { upToKm: 3, feeKurus: 1000 },
          { upToKm: 2, feeKurus: 2000 },
        ],
      }),
    ).toEqual({
      'deliveryTiers.1.upToKm': 'mustIncrease',
      'deliveryTiers.2.upToKm': 'mustIncrease',
    });
  });

  it('should require closesAt after opensAt', () => {
    expect(
      kitchenRuleErrors({
        ...valid,
        hours: [{ dayOfWeek: 1, opensAt: '20:00', closesAt: '11:00' }],
      }),
    ).toEqual({ 'hours.0.closesAt': 'mustBeAfterOpensAt' });
  });

  it('should reject overlapping slots on the same day only', () => {
    expect(
      kitchenRuleErrors({
        ...valid,
        hours: [
          { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
          { dayOfWeek: 2, opensAt: '12:00', closesAt: '13:00' },
          { dayOfWeek: 1, opensAt: '13:00', closesAt: '15:00' },
        ],
      }),
    ).toEqual({ 'hours.2.opensAt': 'overlaps' });
  });
});

describe('deliveryRadiusOf', () => {
  it('should be the last tier while delivery is on', () => {
    expect(deliveryRadiusOf(valid)).toBe(5);
  });

  it('should be null while delivery is off', () => {
    expect(deliveryRadiusOf({ ...valid, deliveryEnabled: false })).toBeNull();
  });
});
