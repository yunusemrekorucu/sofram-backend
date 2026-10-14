export type DiscoveryConfig = {
  /** How far a pickup-only kitchen is listed, in km. */
  pickupRadiusKm: number;
  /** Decimals of the kitchen coordinates the API hands out (3 ≈ 110 m). */
  coordPrecision: number;
};
