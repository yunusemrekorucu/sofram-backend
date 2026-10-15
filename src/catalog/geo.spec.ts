import {
  boundingBox,
  haversineKm,
  haversineSql,
  roundCoord,
  roundDistance,
} from './geo';

describe('haversineKm', () => {
  it('should measure one degree of latitude as ~111.19 km', () => {
    expect(
      haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }),
    ).toBeCloseTo(111.19, 1);
  });

  it('should be zero for the same point', () => {
    const p = { latitude: 40.99, longitude: 29.02 };
    expect(haversineKm(p, p)).toBe(0);
  });
});

describe('boundingBox', () => {
  it('should contain points at the radius in every direction', () => {
    const center = { latitude: 40.99, longitude: 29.02 };
    const box = boundingBox(center, 5);
    const east = { latitude: 40.99, longitude: box.maxLng };
    const north = { latitude: box.maxLat, longitude: 29.02 };

    expect(haversineKm(center, east)).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(haversineKm(center, north)).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(box.minLat).toBeLessThan(center.latitude);
    expect(box.minLng).toBeLessThan(center.longitude);
  });
});

describe('haversineSql', () => {
  it('should embed the given expressions', () => {
    const sql = haversineSql('LAT_EXPR', 'LNG_EXPR');
    expect(sql).toContain('LAT_EXPR');
    expect(sql).toContain('LNG_EXPR');
    expect(sql).toContain(':lat');
    expect(sql).toContain(':lng');
  });
});

describe('rounding', () => {
  it('should round coordinates to the given precision', () => {
    expect(roundCoord(40.98771, 3)).toBe(40.988);
    expect(roundCoord(29.02249, 3)).toBe(29.022);
  });

  it('should round distances to 100 m', () => {
    expect(roundDistance(1.2649)).toBe(1.3);
    expect(roundDistance(0.04)).toBe(0);
  });
});
