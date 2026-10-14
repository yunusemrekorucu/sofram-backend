import { DeliveryTier } from '../catalog/delivery';
import { FieldErrors } from '../catalog/field-errors';
import { KitchenHour, toMinutes } from '../catalog/opening-state';

export type KitchenRulesInput = {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryTiers: DeliveryTier[];
  hours: KitchenHour[];
};

/** Cross-field rules class-validator cannot express; the DTOs check each field. */
export function kitchenRuleErrors(input: KitchenRulesInput): FieldErrors {
  const errors: FieldErrors = {};

  if (!input.pickupEnabled && !input.deliveryEnabled) {
    errors.deliveryEnabled = 'pickupOrDeliveryRequired';
  }

  if (input.deliveryEnabled && input.deliveryTiers.length === 0) {
    errors.deliveryTiers = 'required';
  }

  input.deliveryTiers.forEach((tier, index) => {
    if (index > 0 && tier.upToKm <= input.deliveryTiers[index - 1].upToKm) {
      errors[`deliveryTiers.${index}.upToKm`] = 'mustIncrease';
    }
  });

  input.hours.forEach((slot, index) => {
    const opens = toMinutes(slot.opensAt);
    const closes = toMinutes(slot.closesAt);

    if (closes <= opens) {
      errors[`hours.${index}.closesAt`] = 'mustBeAfterOpensAt';
      return;
    }

    const overlaps = input.hours.some(
      (other, otherIndex) =>
        otherIndex < index &&
        other.dayOfWeek === slot.dayOfWeek &&
        toMinutes(other.opensAt) < closes &&
        opens < toMinutes(other.closesAt),
    );

    if (overlaps) {
      errors[`hours.${index}.opensAt`] = 'overlaps';
    }
  });

  return errors;
}

/**
 * The last tier's `upToKm` while delivery is on — what the discovery query
 * filters by. Tiers are kept while delivery is off so toggling it back on
 * does not lose them.
 */
export function deliveryRadiusOf(
  input: Pick<KitchenRulesInput, 'deliveryEnabled' | 'deliveryTiers'>,
): number | null {
  const last = input.deliveryTiers[input.deliveryTiers.length - 1];
  return input.deliveryEnabled && last ? last.upToKm : null;
}
