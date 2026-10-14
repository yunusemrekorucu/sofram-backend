export type DeliveryTier = { upToKm: number; feeKurus: number };

/** Upper bound for a kitchen's last tier; also sizes the discovery bounding box. */
export const MAX_DELIVERY_RADIUS_KM = 20;

/** Tiers are sorted by `upToKm` (enforced by kitchen rules). */
export function deliveryFeeFor(
  tiers: DeliveryTier[],
  distanceKm: number,
): number | null {
  return tiers.find((tier) => distanceKm <= tier.upToKm)?.feeKurus ?? null;
}
