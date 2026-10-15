export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_KM;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `haversineKm` as SQL, from the given latitude/longitude SQL expressions to `:lat`/`:lng`.
 * Keep the two in step: the API filters with this and re-checks with that.
 */
export const haversineSql = (
  latitudeSql: string,
  longitudeSql: string,
): string =>
  `(2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(` +
  `power(sin(radians(${latitudeSql} - :lat) / 2), 2) + ` +
  `cos(radians(:lat)) * cos(radians(${latitudeSql})) * ` +
  `power(sin(radians(${longitudeSql} - :lng) / 2), 2)))))`;

/** Index-friendly pre-filter; approximates the circle (not guaranteed larger at the east/west edges). */
export function boundingBox(center: LatLng, radiusKm: number) {
  const dLat = radiusKm / KM_PER_DEGREE;
  const dLng = radiusKm / (KM_PER_DEGREE * Math.cos(radians(center.latitude)));

  return {
    minLat: center.latitude - dLat,
    maxLat: center.latitude + dLat,
    minLng: center.longitude - dLng,
    maxLng: center.longitude + dLng,
  };
}

export const roundCoord = (value: number, precision: number): number =>
  Number(value.toFixed(precision));

export const roundDistance = (km: number): number => Math.round(km * 10) / 10;
