# Faz 2 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sofram API'sine kategori, mutfak (aşçı), ürün (aşçı), kullanıcı alerjen tercihi ve konuma göre keşif/arama uçlarını eklemek.

**Architecture:** NestJS + TypeORM (brocoders boilerplate, hexagonal: `domain/` ↔ `infrastructure/persistence/relational/`). Yeni entity'ler hygen generator'larıyla üretilir, sonra dosyalar bu plandaki son hallerine getirilir. Saf iş kuralları (`src/catalog/`, `kitchen-rules`, `product-rules`, `visibility`, `presenters`) birim testli; keşif SQL'i (`DiscoveryRepository`, PostGIS'siz haversine + bounding box) e2e ile test edilir.

**Tech Stack:** NestJS 11, TypeORM 0.3.28, PostgreSQL 16 (Homebrew, Docker yok), class-validator / class-transformer 0.5, Jest 30 + supertest.

**Spec:** `docs/superpowers/specs/2026-10-15-faz2-katalog-design.md` — **§8 "Uygulama notları" tablosu yukarıdaki bölümleri geçersiz kılar** (jsonb sütunlar, `/discover/...` detay yolları, `nameTr`/`nameEn`).

## Global Constraints

- Yanıt zarfı ve hata formatı Faz 1'deki gibi: `{ data, status, statusCode, message }`; hata `errors: { field, message }[]`, nokta yollu (`deliveryTiers.1.upToKm`). 204 sarılmaz. İş kuralı hataları `new UnprocessableEntityException({ status: 422, errors: { field: 'key' } })` şeklinde atılır.
- Başkasının / silinmiş / görünmeyen kaydı → **404** (`{ error: 'notFound' }`), 403 değil. Kullanıcıya ait kayıtlar `orNotFound(...)` ile aranır.
- Endpoint'ler (`/api/v1`, hepsi JWT): `GET /categories`; admin `POST /categories`, `PATCH /categories/:id`; `POST|GET|PATCH /kitchens/me`; `GET|POST /kitchens/me/products`, `PATCH|DELETE /kitchens/me/products/:id`; `GET /discover/kitchens`, `GET /discover/products`, `GET /discover/kitchens/:id`, `GET /discover/products/:id`; `GET|PATCH /auth/me` (+ `allergenPreferences`, `hasKitchen`).
- Para her yerde **kuruş, tamsayı** (`priceKurus`, `feeKurus`, `freeDeliveryMinKurus`).
- Saat dilimi sabit `Europe/Istanbul`; Türkiye'de yaz saati yok (UTC+3).
- Konfigürasyon: `DISCOVERY_PICKUP_RADIUS_KM` (varsayılan 5), `DISCOVERY_COORD_PRECISION` (varsayılan 3). Teslimat yarıçapı üst sınırı `MAX_DELIVERY_RADIUS_KM = 20`.
- Sınırlar: mutfak adı 2–60, açıklama ≤ 500, 1–5 kademe (`upToKm` 0.1–20 kesin artan, `feeKurus` 0–100 000), ≤ 21 saat aralığı; ürün adı 2–80, açıklama ≤ 1000, `priceKurus` 1–10 000 000, `prepMinutes` 1–600, `portionsAvailable` 0–999, 1–5 fotoğraf; keşif `q` 2–50, `limit` ≤ 50.
- Alerjenler: `gluten, crustaceans, eggs, fish, peanuts, soy, milk, tree_nuts, celery, mustard, sesame, sulphites, lupin, molluscs`. Diyet: `vegetarian, vegan`. Satış tipi: `on_demand, daily_portion`.
- Entity ve entity alanları **önce generator ile** eklenir (`npm run generate:resource:relational -- --name X`, `npm run add:property:to-relational -- ...`); ardından dosyalar bu plandaki son hallerine getirilir. `id`/`createdAt`/`updatedAt` generator'a verilmez. `User` ve `File` entity'si generate edilmez.
- Migration'lar elle yazılmaz: `npm run migration:generate -- src/database/migrations/<Ad>` + `npm run migration:run`.
- Ham SQL'de sütunlar tırnaklı yazılır (`k."isPaused"`): Postgres tırnaksız adları küçük harfe çevirir.
- Commit: conventional commits, konu küçük harfle (commitlint `subject-case`). Husky pre-commit `lint` + `test` çalıştırır. Her commit mesajı şu satırla biter:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Yerel ortam: API `http://localhost:3001` (`npm run start:dev`, watch mode), Postgres `localhost:5432` db/rol `sofram`, `.env`'de `AUTH_PHONE_DEV_VERIFIER=true`.

## File Structure

```
src/catalog/                          saf, modülsüz yardımcılar (her biri + .spec.ts)
  catalog.enums.ts                    Allergen, DietTag, SaleType
  fold-turkish.ts                     foldTurkish, likePattern
  geo.ts                              LatLng, haversineKm, haversineSql, boundingBox, roundCoord, roundDistance
  delivery.ts                         DeliveryTier, MAX_DELIVERY_RADIUS_KM, deliveryFeeFor
  opening-state.ts                    KitchenHour, toMinutes, istanbulClock, openingState
  field-errors.ts                     FieldErrors, assertNoFieldErrors
  file-snapshot.ts                    FileSnapshot, toSnapshot, toFileType
src/discovery/config/                 discovery.config.ts, discovery-config.type.ts
src/categories/                       (generator) + public liste, admin create/update
src/users/…                           (generator) allergenPreferences; domain'e hasKitchen
src/auth/auth.service.ts (+ spec)     hasKitchen bayrağı (me, update, login yanıtları)
src/auth/dto/auth-update.dto.ts       + allergenPreferences
src/addresses/addresses.service.ts    findOwned public
src/kitchens/                         (generator) + kitchen-rules.ts (+ spec), sahibine ait CRUD (+ service spec)
src/products/                         (generator) + product-rules.ts (+ spec), sahibine ait CRUD (+ service spec)
src/users/users.service.ts (+ spec)   hesap silme: ürünler → mutfak
src/discovery/                        keşif modülü
  discovery.module.ts
  discovery.controller.ts
  discovery.service.ts
  discovery.repository.ts             TypeORM sorguları (port'suz, salt-okuma)
  dto/discover-query.dto.ts           PointQueryDto, DiscoverQueryDto
  views.ts                            KitchenCard, KitchenSummary, ProductCard, KitchenDetail, MenuSection, ProductDetail
  visibility.ts (+ spec)              isKitchenReachable, isProductListed
  presenters.ts (+ spec)              kitchenCard, kitchenSummary, productCard, kitchenDetail, productDetail
src/database/seeds/relational/
  category/                           kategori seed (her ortam)
  kitchen/                            dev mutfak seed (production'da çalışmaz)
src/database/migrations/*             (generate) CreateCategory, UserAllergenPreferences, CreateKitchen, CreateProduct
test/user/catalog.e2e-spec.ts         uçtan uca akış (Task 4–6'da büyür)
CLAUDE.md                             API conventions'a Faz 2 kuralları
```

---

### Task 0: Başlangıç durumunu doğrula

**Files:** yok (yalnızca doğrulama)

- [ ] **Step 1: Servisleri kontrol et**

Run: `lsof -i :3001 -sTCP:LISTEN; pg_isready; grep AUTH_PHONE_DEV_VERIFIER .env`
Expected: 3001'de node (API), Postgres "accepting connections", `AUTH_PHONE_DEV_VERIFIER=true`. API çalışmıyorsa ayrı bir terminalde (arka planda) `npm run start:dev` başlat.

- [ ] **Step 2: Birim ve e2e paketlerini çalıştır**

Run: `npm test && npm run test:e2e -- --runInBand`
Expected: ikisi de PASS. Kırmızı test varsa DURUP kullanıcıya bildir — başlangıç bozuksa sonraki görevlerin sonucu yorumlanamaz.

---

### Task 1: Katalog çekirdeği (saf yardımcılar + keşif konfigürasyonu)

**Files:**
- Create: `src/catalog/catalog.enums.ts`, `src/catalog/fold-turkish.ts`, `src/catalog/geo.ts`, `src/catalog/delivery.ts`, `src/catalog/opening-state.ts`, `src/catalog/field-errors.ts`, `src/catalog/file-snapshot.ts`
- Test: `src/catalog/fold-turkish.spec.ts`, `src/catalog/geo.spec.ts`, `src/catalog/delivery.spec.ts`, `src/catalog/opening-state.spec.ts`, `src/catalog/field-errors.spec.ts`
- Create: `src/discovery/config/discovery-config.type.ts`, `src/discovery/config/discovery.config.ts`
- Modify: `src/config/config.type.ts`, `src/app.module.ts` (ConfigModule `load`), `env-example-relational`, `.env`

**Interfaces:**
- Consumes: `FileType` (`src/files/domain/file.ts`), `validateConfig` (`src/utils/validate-config.ts`).
- Produces:
  - `enum Allergen { gluten, crustaceans, eggs, fish, peanuts, soy, milk, treeNuts = 'tree_nuts', celery, mustard, sesame, sulphites, lupin, molluscs }`, `enum DietTag { vegetarian, vegan }`, `enum SaleType { onDemand = 'on_demand', dailyPortion = 'daily_portion' }` (değerler küçük harf string).
  - `foldTurkish(text: string): string`, `likePattern(query: string): string`.
  - `type LatLng = { latitude: number; longitude: number }`, `haversineKm(a: LatLng, b: LatLng): number`, `haversineSql(alias: string): string` (`:lat`, `:lng` parametreli), `boundingBox(center: LatLng, radiusKm: number): { minLat; maxLat; minLng; maxLng }`, `roundCoord(value: number, precision: number): number`, `roundDistance(km: number): number` (0.1 km).
  - `type DeliveryTier = { upToKm: number; feeKurus: number }`, `MAX_DELIVERY_RADIUS_KM = 20`, `deliveryFeeFor(tiers: DeliveryTier[], distanceKm: number): number | null`.
  - `type KitchenHour = { dayOfWeek: number; opensAt: string; closesAt: string }`, `type OpeningState = { isOpenNow: boolean; opensAt: Date | null }`, `toMinutes(hhmm: string): number`, `istanbulClock(now: Date): { dayOfWeek: number; time: string }`, `openingState(hours: KitchenHour[], isPaused: boolean, now: Date): OpeningState`.
  - `type FieldErrors = Record<string, string>`, `assertNoFieldErrors(errors: FieldErrors): void` (boş değilse 422 atar).
  - `type FileSnapshot = { id: string; path: string }`, `toSnapshot(file: FileType): FileSnapshot`, `toFileType(snapshot: FileSnapshot): FileType`.
  - Config: `configService.get('discovery.pickupRadiusKm', { infer: true })`, `configService.get('discovery.coordPrecision', { infer: true })`.

- [ ] **Step 1: Enum'lar**

`src/catalog/catalog.enums.ts`:

```ts
/** The 14 allergens of the Turkish Food Codex (same list as EU 1169/2011). */
export enum Allergen {
  gluten = 'gluten',
  crustaceans = 'crustaceans',
  eggs = 'eggs',
  fish = 'fish',
  peanuts = 'peanuts',
  soy = 'soy',
  milk = 'milk',
  treeNuts = 'tree_nuts',
  celery = 'celery',
  mustard = 'mustard',
  sesame = 'sesame',
  sulphites = 'sulphites',
  lupin = 'lupin',
  molluscs = 'molluscs',
}

export enum DietTag {
  vegetarian = 'vegetarian',
  vegan = 'vegan',
}

export enum SaleType {
  /** Cooked when ordered; `prepMinutes` is required. */
  onDemand = 'on_demand',
  /** Cooked ahead in a fixed number of portions; `portionsAvailable` is required. */
  dailyPortion = 'daily_portion',
}
```

- [ ] **Step 2: `foldTurkish` — test**

`src/catalog/fold-turkish.spec.ts`:

```ts
import { foldTurkish, likePattern } from './fold-turkish';

describe('foldTurkish', () => {
  it('should lower-case Turkish capitals correctly', () => {
    expect(foldTurkish('İçli Köfte')).toBe('icli kofte');
    expect(foldTurkish('ISPANAK')).toBe('ispanak');
  });

  it('should fold dotted and dotless i and the diacritics', () => {
    expect(foldTurkish('Mantı')).toBe('manti');
    expect(foldTurkish('MANTI')).toBe('manti');
    expect(foldTurkish('şiş çöğür ünlü')).toBe('sis cogur unlu');
  });

  it('should collapse and trim whitespace', () => {
    expect(foldTurkish('  Ev   usulü\nmantı ')).toBe('ev usulu manti');
  });
});

describe('likePattern', () => {
  it('should wrap the folded query in wildcards', () => {
    expect(likePattern('Köfte')).toBe('%kofte%');
  });

  it('should escape the caller’s own wildcards', () => {
    expect(likePattern('50%_x')).toBe('%50\\%\\_x%');
  });
});
```

Run: `npx jest src/catalog/fold-turkish.spec.ts` → FAIL (modül yok).

- [ ] **Step 3: `foldTurkish` — kod**

`src/catalog/fold-turkish.ts`:

```ts
const FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/**
 * The search key stored in `searchText` and applied to queries:
 * Turkish-aware lower case without diacritics ("İçli Köfte" → "icli kofte").
 * Done here because Postgres `lower()` gets İ/I wrong outside a tr collation.
 */
export function foldTurkish(text: string): string {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/[çğıöşüâîû]/g, (ch) => FOLD[ch])
    .replace(/\s+/g, ' ')
    .trim();
}

/** `%…%` LIKE pattern for a user query; escapes the user's own wildcards. */
export function likePattern(query: string): string {
  return `%${foldTurkish(query).replace(/[\\%_]/g, '\\$&')}%`;
}
```

Run: `npx jest src/catalog/fold-turkish.spec.ts` → PASS (5 test).

- [ ] **Step 4: `geo` — test**

`src/catalog/geo.spec.ts`:

```ts
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

    expect(haversineKm(center, east)).toBeGreaterThanOrEqual(4.99);
    expect(haversineKm(center, north)).toBeGreaterThanOrEqual(4.99);
    expect(box.minLat).toBeLessThan(center.latitude);
    expect(box.minLng).toBeLessThan(center.longitude);
  });
});

describe('haversineSql', () => {
  it('should reference the alias with quoted columns', () => {
    const sql = haversineSql('k');
    expect(sql).toContain('k."latitude"');
    expect(sql).toContain('k."longitude"');
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
```

Run: `npx jest src/catalog/geo.spec.ts` → FAIL.

- [ ] **Step 5: `geo` — kod**

`src/catalog/geo.ts`:

```ts
export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE = 111.32;

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
 * `haversineKm` as SQL, from `alias.latitude/longitude` to `:lat`/`:lng`.
 * Keep the two in step: the API filters with this and re-checks with that.
 */
export const haversineSql = (alias: string): string =>
  `(2 * ${EARTH_RADIUS_KM} * asin(least(1, sqrt(` +
  `power(sin(radians(${alias}."latitude" - :lat) / 2), 2) + ` +
  `cos(radians(:lat)) * cos(radians(${alias}."latitude")) * ` +
  `power(sin(radians(${alias}."longitude" - :lng) / 2), 2)))))`;

/** Index-friendly pre-filter; slightly larger than the circle it bounds. */
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
```

Run: `npx jest src/catalog/geo.spec.ts` → PASS.

- [ ] **Step 6: `delivery` — test ve kod**

`src/catalog/delivery.spec.ts`:

```ts
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
```

Run: `npx jest src/catalog/delivery.spec.ts` → FAIL.

`src/catalog/delivery.ts`:

```ts
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
```

Run: `npx jest src/catalog/delivery.spec.ts` → PASS.

- [ ] **Step 7: `openingState` — test**

`src/catalog/opening-state.spec.ts` (2026-10-12 bir Pazartesi; İstanbul = UTC+3):

```ts
import { istanbulClock, openingState } from './opening-state';

const MONDAY = [
  { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
  { dayOfWeek: 1, opensAt: '17:00', closesAt: '21:00' },
];

describe('istanbulClock', () => {
  it('should report Istanbul weekday and time', () => {
    expect(istanbulClock(new Date('2026-10-12T09:30:00Z'))).toEqual({
      dayOfWeek: 1,
      time: '12:30',
    });
  });

  it('should already be Monday in Istanbul while it is Sunday in UTC', () => {
    expect(istanbulClock(new Date('2026-10-11T22:30:00Z'))).toEqual({
      dayOfWeek: 1,
      time: '01:30',
    });
  });

  it('should write midnight as 00, not 24', () => {
    expect(istanbulClock(new Date('2026-10-11T21:00:00Z')).time).toBe('00:00');
  });
});

describe('openingState', () => {
  it('should be open inside a slot', () => {
    expect(
      openingState(MONDAY, false, new Date('2026-10-12T09:30:00Z')),
    ).toEqual({ isOpenNow: true, opensAt: null });
  });

  it('should treat closesAt as exclusive', () => {
    const state = openingState(MONDAY, false, new Date('2026-10-12T11:00:00Z'));
    expect(state.isOpenNow).toBe(false);
  });

  it('should point at the next slot the same day, on the minute', () => {
    expect(
      openingState(MONDAY, false, new Date('2026-10-12T12:00:30Z')),
    ).toEqual({ isOpenNow: false, opensAt: new Date('2026-10-12T14:00:00Z') });
  });

  it('should wrap to the same weekday next week', () => {
    expect(
      openingState(MONDAY, false, new Date('2026-10-12T19:00:00Z')),
    ).toEqual({ isOpenNow: false, opensAt: new Date('2026-10-19T08:00:00Z') });
  });

  it('should be closed with no next opening while paused', () => {
    expect(
      openingState(MONDAY, true, new Date('2026-10-12T09:30:00Z')),
    ).toEqual({ isOpenNow: false, opensAt: null });
  });

  it('should be closed with no next opening without hours', () => {
    expect(openingState([], false, new Date('2026-10-12T09:30:00Z'))).toEqual({
      isOpenNow: false,
      opensAt: null,
    });
  });
});
```

Run: `npx jest src/catalog/opening-state.spec.ts` → FAIL.

- [ ] **Step 8: `openingState` — kod**

`src/catalog/opening-state.ts`:

```ts
export type KitchenHour = {
  /** 1 = Monday … 7 = Sunday */
  dayOfWeek: number;
  /** "HH:mm", Istanbul time */
  opensAt: string;
  /** "HH:mm", exclusive, after opensAt (no slots across midnight) */
  closesAt: string;
};

export type OpeningState = { isOpenNow: boolean; opensAt: Date | null };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const istanbulParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const toMinutes = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Weekday (1 = Monday) and "HH:mm" in Istanbul. */
export function istanbulClock(now: Date): { dayOfWeek: number; time: string } {
  const parts = Object.fromEntries(
    istanbulParts.formatToParts(now).map((part) => [part.type, part.value]),
  );

  return {
    dayOfWeek: WEEKDAY[parts.weekday],
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Open now, or when it opens next (within a week). A paused kitchen has no
 * "next opening": the cook resumes it by hand.
 */
export function openingState(
  hours: KitchenHour[],
  isPaused: boolean,
  now: Date,
): OpeningState {
  const { dayOfWeek, time } = istanbulClock(now);
  const minute = toMinutes(time);

  const isOpenNow =
    !isPaused &&
    hours.some(
      (slot) =>
        slot.dayOfWeek === dayOfWeek &&
        toMinutes(slot.opensAt) <= minute &&
        minute < toMinutes(slot.closesAt),
    );

  if (isOpenNow || isPaused) {
    return { isOpenNow, opensAt: null };
  }

  // Turkey has no DST, so Istanbul midnight is a fixed distance from `now`.
  const midnight =
    now.getTime() - (now.getTime() % MINUTE_MS) - minute * MINUTE_MS;

  for (let offset = 0; offset <= 7; offset++) {
    const day = ((dayOfWeek - 1 + offset) % 7) + 1;
    const [next] = hours
      .filter((slot) => slot.dayOfWeek === day)
      .map((slot) => toMinutes(slot.opensAt))
      .filter((opens) => offset > 0 || opens > minute)
      .sort((a, b) => a - b);

    if (next !== undefined) {
      return {
        isOpenNow: false,
        opensAt: new Date(midnight + offset * DAY_MS + next * MINUTE_MS),
      };
    }
  }

  return { isOpenNow: false, opensAt: null };
}
```

Run: `npx jest src/catalog/opening-state.spec.ts` → PASS (9 test).

- [ ] **Step 9: `field-errors` ve `file-snapshot`**

`src/catalog/field-errors.spec.ts`:

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import { assertNoFieldErrors } from './field-errors';

describe('assertNoFieldErrors', () => {
  it('should pass when there are no errors', () => {
    expect(() => assertNoFieldErrors({})).not.toThrow();
  });

  it('should throw the boilerplate 422 shape with dotted keys intact', () => {
    const run = () =>
      assertNoFieldErrors({ 'deliveryTiers.1.upToKm': 'mustIncrease' });
    let response: unknown;

    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      response = (error as UnprocessableEntityException).getResponse();
    }

    expect(response).toEqual({
      status: 422,
      errors: { 'deliveryTiers.1.upToKm': 'mustIncrease' },
    });
  });
});
```

`src/catalog/field-errors.ts`:

```ts
import { HttpStatus, UnprocessableEntityException } from '@nestjs/common';

/** `{ 'hours.2.closesAt': 'mustBeAfterOpensAt' }` — flattened as-is by AllExceptionsFilter. */
export type FieldErrors = Record<string, string>;

export function assertNoFieldErrors(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors,
    });
  }
}
```

`src/catalog/file-snapshot.ts`:

```ts
import { FileType } from '../files/domain/file';

/** A file stored inline (jsonb) on the record that shows it. */
export type FileSnapshot = { id: string; path: string };

export const toSnapshot = (file: FileType): FileSnapshot => ({
  id: file.id,
  path: file.path,
});

/** Back to a FileType instance so its @Transform turns `path` into a URL. */
export const toFileType = (snapshot: FileSnapshot): FileType =>
  Object.assign(new FileType(), snapshot);
```

Run: `npx jest src/catalog` → PASS.

- [ ] **Step 10: Keşif konfigürasyonu**

`src/discovery/config/discovery-config.type.ts`:

```ts
export type DiscoveryConfig = {
  /** How far a pickup-only kitchen is listed, in km. */
  pickupRadiusKm: number;
  /** Decimals of the kitchen coordinates the API hands out (3 ≈ 110 m). */
  coordPrecision: number;
};
```

`src/discovery/config/discovery.config.ts`:

```ts
import { registerAs } from '@nestjs/config';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { DiscoveryConfig } from './discovery-config.type';

class EnvironmentVariablesValidator {
  @IsNumber()
  @Min(0.1)
  @Max(50)
  @IsOptional()
  DISCOVERY_PICKUP_RADIUS_KM: number;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  DISCOVERY_COORD_PRECISION: number;
}

export default registerAs<DiscoveryConfig>('discovery', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    pickupRadiusKm: process.env.DISCOVERY_PICKUP_RADIUS_KM
      ? Number(process.env.DISCOVERY_PICKUP_RADIUS_KM)
      : 5,
    coordPrecision: process.env.DISCOVERY_COORD_PRECISION
      ? parseInt(process.env.DISCOVERY_COORD_PRECISION, 10)
      : 3,
  };
});
```

`src/config/config.type.ts` — import ve alan ekle:

```ts
import { DiscoveryConfig } from '../discovery/config/discovery-config.type';
// …
export type AllConfigType = {
  // …mevcut alanlar
  discovery: DiscoveryConfig;
};
```

`src/app.module.ts` — `import discoveryConfig from './discovery/config/discovery.config';` ekle ve `ConfigModule.forRoot({ load: [...] })` listesinin sonuna `discoveryConfig,` ekle.

`env-example-relational` ve `.env` sonuna:

```
DISCOVERY_PICKUP_RADIUS_KM=5
DISCOVERY_COORD_PRECISION=3
```

Run: `npm run build`
Expected: derleme hatasız.

- [ ] **Step 11: Commit**

```bash
git add src/catalog src/discovery/config src/config/config.type.ts src/app.module.ts env-example-relational
git commit -m "feat(catalog): add search folding, geo, delivery fee and opening hours helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`.env` commit edilmez.)

---

### Task 2: Kategoriler (`/api/v1/categories`) + kategori seed

**Files:**
- Generate: `src/categories/**`, `src/app.module.ts` (generator enjekte eder)
- Modify (generator sonrası, son halleri aşağıda): `src/categories/domain/category.ts`, `src/categories/infrastructure/persistence/relational/entities/category.entity.ts`, `src/categories/infrastructure/persistence/relational/mappers/category.mapper.ts`, `src/categories/infrastructure/persistence/category.repository.ts`, `src/categories/infrastructure/persistence/relational/repositories/category.repository.ts`, `src/categories/dto/create-category.dto.ts`, `src/categories/dto/update-category.dto.ts`, `src/categories/categories.service.ts`, `src/categories/categories.controller.ts`
- Delete: `src/categories/dto/find-all-categories.dto.ts`
- Create: `src/categories/categories.service.spec.ts`, `src/database/seeds/relational/category/category-seed.module.ts`, `src/database/seeds/relational/category/category-seed.service.ts`
- Modify: `src/database/seeds/relational/seed.module.ts`, `src/database/seeds/relational/run-seed.ts`
- Create (generate): `src/database/migrations/<timestamp>-CreateCategory.ts`

**Interfaces:**
- Consumes: `orNotFound`, `RolesGuard`, `Roles`, `RoleEnum`.
- Produces:
  - `Category` domain: `{ id: string; slug: string; nameTr: string; nameEn: string; icon: string | null; sortOrder: number; isActive: boolean; createdAt: Date; updatedAt: Date }`.
  - `CategoryEntity` (tablo `category`), `CategoryMapper.toDomain(raw: CategoryEntity): Category`.
  - `CategoriesService.listActive(): Promise<Category[]>`, `CategoriesService.findActive(id: string): Promise<Category | null>`, `create(dto)`, `update(id, dto)`.
  - `CategoriesModule` exports `CategoriesService`.
  - REST: `GET /categories` → `Category[]` (aktifler, `sortOrder`, sonra `nameTr`); admin `POST /categories` → 201, `PATCH /categories/:id`; slug çakışması → 422 `{ slug: 'alreadyExists' }`.

- [ ] **Step 1: Resource'u ve alanları generator ile üret (sırayla)**

```bash
npm run generate:resource:relational -- --name Category
npm run add:property:to-relational -- --name Category --property slug --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Category --property nameTr --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Category --property nameEn --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Category --property icon --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Category --property sortOrder --kind primitive --type number --isAddToDto true --isOptional true --isNullable false
npm run add:property:to-relational -- --name Category --property isActive --kind primitive --type boolean --isAddToDto true --isOptional true --isNullable false
```

Kontrol: `git status` → `src/categories/` yeni, `src/app.module.ts` değişmiş (`CategoriesModule` eklenmiş). Generator'ın oluşturduğu dosya adları yukarıdaki **Files** listesiyle eşleşmiyorsa DURUP kullanıcıya bildir.

- [ ] **Step 2: Domain, entity, mapper**

`src/categories/domain/category.ts` — dosyanın tamamı:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class Category {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'soup' })
  slug: string;

  @ApiProperty({ type: String, example: 'Çorba' })
  nameTr: string;

  @ApiProperty({ type: String, example: 'Soup' })
  nameEn: string;

  @ApiProperty({ type: String, nullable: true, example: 'soup' })
  icon: string | null;

  @ApiProperty({ type: Number })
  sortOrder: number;

  @ApiProperty({ type: Boolean })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

`src/categories/infrastructure/persistence/relational/entities/category.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'category',
})
export class CategoryEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: String, unique: true })
  slug: string;

  @Column({ type: String })
  nameTr: string;

  @Column({ type: String })
  nameEn: string;

  @Column({ type: String, nullable: true })
  icon: string | null;

  @Column({ type: Number, default: 0 })
  sortOrder: number;

  @Column({ type: Boolean, default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

`src/categories/infrastructure/persistence/relational/mappers/category.mapper.ts` — dosyanın tamamı:

```ts
import { Category } from '../../../../domain/category';
import { CategoryEntity } from '../entities/category.entity';

export class CategoryMapper {
  static toDomain(raw: CategoryEntity): Category {
    return Object.assign(new Category(), {
      id: raw.id,
      slug: raw.slug,
      nameTr: raw.nameTr,
      nameEn: raw.nameEn,
      icon: raw.icon,
      sortOrder: raw.sortOrder,
      isActive: raw.isActive,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static toPersistence(domain: Partial<Category>): CategoryEntity {
    return Object.assign(new CategoryEntity(), domain);
  }
}
```

- [ ] **Step 3: Repository**

`src/categories/infrastructure/persistence/category.repository.ts` — dosyanın tamamı:

```ts
import { NullableType } from '../../../utils/types/nullable.type';
import { Category } from '../../domain/category';

export abstract class CategoryRepository {
  abstract create(
    data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Category>;

  /** Active ones, by sortOrder then Turkish name. */
  abstract findActive(): Promise<Category[]>;

  abstract findById(id: Category['id']): Promise<NullableType<Category>>;

  abstract findBySlug(slug: Category['slug']): Promise<NullableType<Category>>;

  abstract update(
    id: Category['id'],
    payload: Partial<Category>,
  ): Promise<Category>;
}
```

`src/categories/infrastructure/persistence/relational/repositories/category.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Category } from '../../../../domain/category';
import { CategoryRepository } from '../../category.repository';
import { CategoryEntity } from '../entities/category.entity';
import { CategoryMapper } from '../mappers/category.mapper';

@Injectable()
export class CategoryRelationalRepository implements CategoryRepository {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  async create(
    data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Category> {
    const entity = await this.categoryRepository.save(
      this.categoryRepository.create(CategoryMapper.toPersistence(data)),
    );
    return CategoryMapper.toDomain(entity);
  }

  async findActive(): Promise<Category[]> {
    const entities = await this.categoryRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', nameTr: 'ASC' },
    });
    return entities.map((entity) => CategoryMapper.toDomain(entity));
  }

  async findById(id: Category['id']): Promise<NullableType<Category>> {
    const entity = await this.categoryRepository.findOne({ where: { id } });
    return entity ? CategoryMapper.toDomain(entity) : null;
  }

  async findBySlug(slug: Category['slug']): Promise<NullableType<Category>> {
    const entity = await this.categoryRepository.findOne({ where: { slug } });
    return entity ? CategoryMapper.toDomain(entity) : null;
  }

  async update(
    id: Category['id'],
    payload: Partial<Category>,
  ): Promise<Category> {
    await this.categoryRepository.update(
      id,
      CategoryMapper.toPersistence(payload),
    );
    const entity = await this.categoryRepository.findOneOrFail({
      where: { id },
    });
    return CategoryMapper.toDomain(entity);
  }
}
```

(Generator'ın `relational-persistence.module.ts`'i `CategoryRepository` → `CategoryRelationalRepository` bağlamasını zaten yapar; dokunma.)

- [ ] **Step 4: DTO'lar**

`src/categories/dto/create-category.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'soup' })
  @Matches(/^[a-z0-9-]+$/, { message: 'invalidSlug' })
  @Length(2, 40)
  slug: string;

  @ApiProperty({ example: 'Çorba' })
  @IsString()
  @Length(1, 40)
  nameTr: string;

  @ApiProperty({ example: 'Soup' })
  @IsString()
  @Length(1, 40)
  nameEn: string;

  @ApiPropertyOptional({ example: 'soup', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
```

`src/categories/dto/update-category.dto.ts` — dosyanın tamamı:

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';

// skipNullProperties: false → an explicit null on a NOT NULL column is a 422.
export class UpdateCategoryDto extends PartialType(CreateCategoryDto, {
  skipNullProperties: false,
}) {}
```

Sil: `rm src/categories/dto/find-all-categories.dto.ts`

- [ ] **Step 5: Servis — test**

`src/categories/categories.service.spec.ts`:

```ts
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Category } from './domain/category';
import { CategoryRepository } from './infrastructure/persistence/category.repository';

const aCategory = (overrides: Partial<Category> = {}): Category =>
  Object.assign(new Category(), {
    id: 'c1',
    slug: 'soup',
    nameTr: 'Çorba',
    nameEn: 'Soup',
    icon: null,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  });

const build = () => {
  const repository = {
    create: jest.fn().mockImplementation((data) => aCategory(data)),
    findActive: jest.fn(),
    findById: jest.fn().mockResolvedValue(null),
    findBySlug: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockImplementation((id, data) => aCategory({ id, ...data })),
  };
  const service = new CategoriesService(
    repository as unknown as CategoryRepository,
  );
  return { service, repository };
};

describe('CategoriesService', () => {
  it('should default sortOrder, isActive and icon on create', async () => {
    const { service, repository } = build();

    await service.create({ slug: 'soup', nameTr: 'Çorba', nameEn: 'Soup' });

    expect(repository.create).toHaveBeenCalledWith({
      slug: 'soup',
      nameTr: 'Çorba',
      nameEn: 'Soup',
      icon: null,
      sortOrder: 0,
      isActive: true,
    });
  });

  it('should refuse a taken slug with a field error', async () => {
    const { service, repository } = build();
    repository.findBySlug.mockResolvedValue(aCategory({ id: 'other' }));

    await expect(
      service.create({ slug: 'soup', nameTr: 'Çorba', nameEn: 'Soup' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should allow keeping its own slug on update', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue(aCategory());
    repository.findBySlug.mockResolvedValue(aCategory());

    await expect(service.update('c1', { slug: 'soup' })).resolves.toMatchObject(
      { id: 'c1' },
    );
  });

  it('should 404 an unknown category on update', async () => {
    const { service } = build();

    await expect(service.update('nope', { nameTr: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should hide an inactive category from findActive', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue(aCategory({ isActive: false }));

    await expect(service.findActive('c1')).resolves.toBeNull();
  });
});
```

Run: `npx jest src/categories/categories.service.spec.ts` → FAIL (generator'ın servisi bu API'ye sahip değil).

- [ ] **Step 6: Servis — kod**

`src/categories/categories.service.ts` — dosyanın tamamı:

```ts
import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { orNotFound } from '../utils/or-not-found';
import { Category } from './domain/category';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryRepository } from './infrastructure/persistence/category.repository';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoryRepository: CategoryRepository) {}

  listActive(): Promise<Category[]> {
    return this.categoryRepository.findActive();
  }

  /** null when missing or deactivated — products may only use active ones. */
  async findActive(id: Category['id']): Promise<Category | null> {
    const category = await this.categoryRepository.findById(id);
    return category?.isActive ? category : null;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    await this.assertSlugFree(dto.slug);

    return this.categoryRepository.create({
      slug: dto.slug,
      nameTr: dto.nameTr,
      nameEn: dto.nameEn,
      icon: dto.icon ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
  }

  async update(id: Category['id'], dto: UpdateCategoryDto): Promise<Category> {
    await orNotFound(this.categoryRepository.findById(id));

    if (dto.slug !== undefined) {
      await this.assertSlugFree(dto.slug, id);
    }

    return this.categoryRepository.update(id, dto);
  }

  private async assertSlugFree(
    slug: Category['slug'],
    ownId?: Category['id'],
  ): Promise<void> {
    const holder = await this.categoryRepository.findBySlug(slug);

    if (holder && holder.id !== ownId) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { slug: 'alreadyExists' },
      });
    }
  }
}
```

Run: `npx jest src/categories/categories.service.spec.ts` → PASS (5 test).

- [ ] **Step 7: Controller**

`src/categories/categories.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { CategoriesService } from './categories.service';
import { Category } from './domain/category';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'categories',
  version: '1',
})
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOkResponse({ type: Category, isArray: true })
  findAll(): Promise<Category[]> {
    return this.categoriesService.listActive();
  }

  @Post()
  @Roles(RoleEnum.admin)
  @UseGuards(RolesGuard)
  @ApiCreatedResponse({ type: Category })
  create(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @Roles(RoleEnum.admin)
  @UseGuards(RolesGuard)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: Category })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.update(id, dto);
  }
}
```

`src/categories/categories.module.ts` — `exports` dizisinde `CategoriesService` olduğunu doğrula (generator `exports: [CategoriesService, RelationalCategoryPersistenceModule]` üretir); yoksa ekle.

- [ ] **Step 8: Migration**

```bash
npm run migration:generate -- src/database/migrations/CreateCategory
npm run migration:run
```

Expected: yeni dosya yalnızca `CREATE TABLE "category"` (+ `slug` unique constraint) içerir; başka tabloya dokunan bir ifade varsa DURUP kullanıcıya bildir.

- [ ] **Step 9: Kategori seed**

`src/database/seeds/relational/category/category-seed.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';

const CATEGORIES = [
  { slug: 'main-dish', nameTr: 'Ana yemek', nameEn: 'Main dish', icon: 'main-dish' },
  { slug: 'soup', nameTr: 'Çorba', nameEn: 'Soup', icon: 'soup' },
  { slug: 'pastry', nameTr: 'Hamur işi', nameEn: 'Pastry', icon: 'pastry' },
  { slug: 'olive-oil', nameTr: 'Zeytinyağlı', nameEn: 'Olive oil dishes', icon: 'olive-oil' },
  { slug: 'dessert', nameTr: 'Tatlı', nameEn: 'Dessert', icon: 'dessert' },
  { slug: 'breakfast', nameTr: 'Kahvaltılık', nameEn: 'Breakfast', icon: 'breakfast' },
  { slug: 'salad', nameTr: 'Salata', nameEn: 'Salad', icon: 'salad' },
  { slug: 'drink', nameTr: 'İçecek', nameEn: 'Drink', icon: 'drink' },
];

@Injectable()
export class CategorySeedService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly repository: Repository<CategoryEntity>,
  ) {}

  /** Inserts the missing slugs; never overwrites an admin's edits. */
  async run() {
    for (const [sortOrder, category] of CATEGORIES.entries()) {
      const exists = await this.repository.exists({
        where: { slug: category.slug },
      });

      if (!exists) {
        await this.repository.save(
          this.repository.create({ ...category, sortOrder, isActive: true }),
        );
      }
    }
  }
}
```

`src/database/seeds/relational/category/category-seed.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { CategorySeedService } from './category-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([CategoryEntity])],
  providers: [CategorySeedService],
  exports: [CategorySeedService],
})
export class CategorySeedModule {}
```

`seed.module.ts` — `imports` dizisine `CategorySeedModule` ekle (import satırıyla). `run-seed.ts` — `UserSeedService`'ten sonra:

```ts
  await app.get(CategorySeedService).run();
```

(import: `import { CategorySeedService } from './category/category-seed.service';`)

Run: `npm run seed:run:relational`
Expected: hatasız biter; `psql -d sofram -c 'select slug, "sortOrder" from category order by "sortOrder"'` 8 satır gösterir. İkinci kez çalıştırınca satır sayısı değişmez.

- [ ] **Step 10: Elle doğrula ve commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add src/categories src/app.module.ts src/database/migrations src/database/seeds
git commit -m "feat(categories): platform category list with admin create and update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Kullanıcı alerjen tercihleri

**Files:**
- Generate/Modify: `src/users/infrastructure/persistence/relational/entities/user.entity.ts`, `src/users/domain/user.ts`, `src/users/infrastructure/persistence/relational/mappers/user.mapper.ts`, `src/users/dto/create-user.dto.ts`, `src/users/users.service.ts` (generator satırları ekler)
- Modify: `src/auth/dto/auth-update.dto.ts`
- Create: `src/auth/dto/auth-update.dto.spec.ts`
- Create (generate): `src/database/migrations/<timestamp>-UserAllergenPreferences.ts`

**Interfaces:**
- Consumes: `Allergen` (Task 1).
- Produces: `User.allergenPreferences?: Allergen[]` (DB'de `simple-array`, varsayılan boş), `User.hasKitchen?: boolean` (saklanmaz; Task 4 doldurur). `PATCH /auth/me` `allergenPreferences: Allergen[]` kabul eder (tekrarsız, listede olmayan değer → 422).

- [ ] **Step 1: DTO testi (önce kırmızı)**

`src/auth/dto/auth-update.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUpdateDto } from './auth-update.dto';

const invalidFields = async (body: object) =>
  (await validate(plainToInstance(AuthUpdateDto, body))).map(
    (error) => error.property,
  );

describe('AuthUpdateDto.allergenPreferences', () => {
  it('should accept known allergens and an empty list', async () => {
    expect(
      await invalidFields({ allergenPreferences: ['milk', 'tree_nuts'] }),
    ).toEqual([]);
    expect(await invalidFields({ allergenPreferences: [] })).toEqual([]);
  });

  it('should reject unknown values and duplicates', async () => {
    expect(await invalidFields({ allergenPreferences: ['peanut'] })).toEqual([
      'allergenPreferences',
    ]);
    expect(
      await invalidFields({ allergenPreferences: ['milk', 'milk'] }),
    ).toEqual(['allergenPreferences']);
  });

  it('should reject a non-array', async () => {
    expect(await invalidFields({ allergenPreferences: 'milk' })).toEqual([
      'allergenPreferences',
    ]);
  });
});
```

Run: `npx jest src/auth/dto/auth-update.dto.spec.ts` → FAIL (`whitelist` yokken bile alan doğrulanmıyor; ilk iki "reject" testi kırmızı).

- [ ] **Step 2: Alanı generator ile ekle**

```bash
npm run add:property:to-relational -- --name User --property allergenPreferences --kind primitive --type string --isAddToDto true --isOptional true --isNullable false
```

Kontrol: `git diff --stat src/users` → entity, domain, mapper, `create-user.dto.ts`, `users.service.ts` değişmiş.

- [ ] **Step 3: Generator çıktısını düzelt**

`user.entity.ts` — generator'ın eklediği `allergenPreferences` sütununu şununla değiştir (import: `import { Allergen } from '../../../../../catalog/catalog.enums';`):

```ts
  @Column({ type: 'simple-array', default: '' })
  allergenPreferences?: Allergen[];
```

`src/users/domain/user.ts` — generator'ın eklediği alanı şununla değiştir ve hemen altına `hasKitchen` ekle (import: `import { Allergen } from '../../catalog/catalog.enums';`):

```ts
  @ApiProperty({ enum: Allergen, isArray: true })
  allergenPreferences?: Allergen[];

  /** Derived per request (AuthService); never stored. */
  @ApiProperty({ type: Boolean })
  hasKitchen?: boolean;
```

`src/users/dto/create-user.dto.ts` — generator'ın eklediği alanı şununla değiştir (class-validator importuna `ArrayUnique, IsArray, IsEnum` ekle; `ApiPropertyOptional` ve `Allergen` import et):

```ts
  @ApiPropertyOptional({ enum: Allergen, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Allergen, { each: true })
  allergenPreferences?: Allergen[];
```

`users.service.ts` — generator'ın create ve update payload'larına eklediği `allergenPreferences: …Dto.allergenPreferences,` satırları kalır.

`src/auth/dto/auth-update.dto.ts` — sınıfın sonuna aynı alanı ekle (importlar: `ArrayUnique, IsArray, IsEnum` class-validator'dan; `Allergen` `../../catalog/catalog.enums`'tan):

```ts
  @ApiPropertyOptional({ enum: Allergen, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Allergen, { each: true })
  allergenPreferences?: Allergen[];
```

(`AuthService.update` `...changes` ile `usersService.update`'e geçirir; ek kod gerekmez.)

Run: `npx jest src/auth/dto/auth-update.dto.spec.ts` → PASS (3 test).

- [ ] **Step 4: Migration**

```bash
npm run migration:generate -- src/database/migrations/UserAllergenPreferences
npm run migration:run
```

Expected: tek ifade — `ALTER TABLE "user" ADD "allergenPreferences" text NOT NULL DEFAULT ''`.

- [ ] **Step 5: Elle doğrula**

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/phone/login -H 'content-type: application/json' -d '{"idToken":"dev:+905559990001"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
curl -s -X PATCH localhost:3001/api/v1/auth/me -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"allergenPreferences":["milk","eggs"]}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.allergenPreferences'
```

Expected: `[ 'milk', 'eggs' ]`.

- [ ] **Step 6: Commit**

```bash
npm test && npm run lint
git add src/users src/auth/dto src/database/migrations
git commit -m "feat(users): store allergen preferences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mutfak (`/api/v1/kitchens/me`) + `hasKitchen`

**Files:**
- Generate: `src/kitchens/**`, `src/app.module.ts`
- Modify (generator sonrası, son halleri aşağıda): `src/kitchens/domain/kitchen.ts`, `src/kitchens/infrastructure/persistence/relational/entities/kitchen.entity.ts`, `src/kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper.ts`, `src/kitchens/infrastructure/persistence/kitchen.repository.ts`, `src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts`, `src/kitchens/dto/create-kitchen.dto.ts`, `src/kitchens/dto/update-kitchen.dto.ts`, `src/kitchens/kitchens.service.ts`, `src/kitchens/kitchens.controller.ts`, `src/kitchens/kitchens.module.ts`
- Delete: `src/kitchens/dto/find-all-kitchens.dto.ts`
- Create: `src/kitchens/kitchen-rules.ts`, `src/kitchens/kitchen-rules.spec.ts`, `src/kitchens/kitchens.service.spec.ts`, `test/user/catalog.e2e-spec.ts`
- Modify: `src/addresses/addresses.service.ts` (`findOwned` public), `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `src/auth/auth.module.ts`
- Create (generate): `src/database/migrations/<timestamp>-CreateKitchen.ts`

**Interfaces:**
- Consumes: Task 1 (`DeliveryTier`, `KitchenHour`, `toMinutes`, `FieldErrors`, `assertNoFieldErrors`, `foldTurkish`, `FileSnapshot`, `toSnapshot`, `toFileType`), `AddressesService.findOwned`, `FilesService.findByIds`, `orNotFound`.
- Produces:
  - `Kitchen` domain: `{ id: string; ownerId: User['id']; name: string; description: string | null; coverPhoto: FileType | null; fullAddress: string; district: string; neighborhood: string; latitude: number; longitude: number; pickupEnabled: boolean; deliveryEnabled: boolean; deliveryTiers: DeliveryTier[]; deliveryRadiusKm: number | null; freeDeliveryMinKurus: number | null; hours: KitchenHour[]; isPaused: boolean; isVerified: boolean; searchText: string; createdAt: Date; updatedAt: Date }` — `ownerId`, `deliveryRadiusKm`, `searchText` yanıtta görünmez.
  - `KitchenEntity` (tablo `kitchen`, soft delete), `KitchenMapper.toDomain(raw: KitchenEntity): Kitchen`.
  - `kitchenRuleErrors(input: KitchenRulesInput): FieldErrors`, `deliveryRadiusOf(input): number | null`.
  - `KitchensService.findByOwner(ownerId): Promise<Kitchen | null>`, `findMine(ownerId): Promise<Kitchen>` (yoksa 404), `create(ownerId, dto)`, `update(ownerId, dto)`, `removeForOwner(ownerId): Promise<void>`.
  - `KitchensModule` exports `KitchensService`, `RelationalKitchenPersistenceModule` (Task 6 `KitchenEntity`'yi kullanır).
  - `DeliveryTierDto`, `KitchenHourDto` (`src/kitchens/dto/create-kitchen.dto.ts`; Task 6 Swagger tipleri için).
  - REST: `POST /kitchens/me` → 201 (`409 { error: 'kitchenAlreadyExists' }`), `GET /kitchens/me`, `PATCH /kitchens/me` (yoksa 404).
  - `User.hasKitchen` `GET|PATCH /auth/me` ve login yanıtlarında dolu.

- [ ] **Step 1: Kurallar — test**

`src/kitchens/kitchen-rules.spec.ts`:

```ts
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
      kitchenRuleErrors({ ...valid, pickupEnabled: false, deliveryEnabled: false }),
    ).toEqual({ deliveryEnabled: 'pickupOrDeliveryRequired' });
  });

  it('should require tiers while delivery is on, not while it is off', () => {
    expect(kitchenRuleErrors({ ...valid, deliveryTiers: [] })).toEqual({
      deliveryTiers: 'required',
    });
    expect(
      kitchenRuleErrors({ ...valid, deliveryEnabled: false, deliveryTiers: [] }),
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
```

Run: `npx jest src/kitchens/kitchen-rules.spec.ts` → FAIL (modül yok).

- [ ] **Step 2: Kurallar — kod**

`src/kitchens/kitchen-rules.ts`:

```ts
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
```

Run: `npx jest src/kitchens/kitchen-rules.spec.ts` → PASS (8 test).

- [ ] **Step 3: Resource'u ve alanları generator ile üret (sırayla)**

```bash
npm run generate:resource:relational -- --name Kitchen
npm run add:property:to-relational -- --name Kitchen --property owner --kind reference --type User --referenceType oneToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Kitchen --property name --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Kitchen --property description --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Kitchen --property coverPhoto --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Kitchen --property fullAddress --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property district --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property neighborhood --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property latitude --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property longitude --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property pickupEnabled --kind primitive --type boolean --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Kitchen --property deliveryEnabled --kind primitive --type boolean --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Kitchen --property deliveryTiers --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property deliveryRadiusKm --kind primitive --type number --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Kitchen --property freeDeliveryMinKurus --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Kitchen --property hours --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Kitchen --property isPaused --kind primitive --type boolean --isAddToDto true --isOptional true --isNullable false
npm run add:property:to-relational -- --name Kitchen --property isVerified --kind primitive --type boolean --isAddToDto false --isOptional true --isNullable false
npm run add:property:to-relational -- --name Kitchen --property searchText --kind primitive --type string --isAddToDto false --isOptional false
```

(`coverPhoto`, `deliveryTiers`, `hours` string olarak üretilir; Step 4'te jsonb yapılır.)

Kontrol: `git status` → `src/kitchens/` yeni, `src/app.module.ts`'te `KitchensModule`.

- [ ] **Step 4: Domain, entity, mapper**

`src/kitchens/domain/kitchen.ts` — dosyanın tamamı:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { DeliveryTier } from '../../catalog/delivery';
import { KitchenHour } from '../../catalog/opening-state';
import { FileType } from '../../files/domain/file';
import { User } from '../../users/domain/user';
import { DeliveryTierDto, KitchenHourDto } from '../dto/create-kitchen.dto';

/** The cook's own view of the kitchen (GET/PATCH /kitchens/me). */
export class Kitchen {
  @ApiProperty({ type: String })
  id: string;

  @Exclude({ toPlainOnly: true })
  ownerId: User['id'];

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  coverPhoto: FileType | null;

  @ApiProperty({ type: String })
  fullAddress: string;

  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: String })
  neighborhood: string;

  @ApiProperty({ type: Number })
  latitude: number;

  @ApiProperty({ type: Number })
  longitude: number;

  @ApiProperty({ type: Boolean })
  pickupEnabled: boolean;

  @ApiProperty({ type: Boolean })
  deliveryEnabled: boolean;

  @ApiProperty({ type: () => DeliveryTierDto, isArray: true })
  deliveryTiers: DeliveryTier[];

  @Exclude({ toPlainOnly: true })
  deliveryRadiusKm: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  freeDeliveryMinKurus: number | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  hours: KitchenHour[];

  @ApiProperty({ type: Boolean })
  isPaused: boolean;

  @ApiProperty({ type: Boolean })
  isVerified: boolean;

  @Exclude({ toPlainOnly: true })
  searchText: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

`src/kitchens/infrastructure/persistence/relational/entities/kitchen.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryTier } from '../../../../../catalog/delivery';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { KitchenHour } from '../../../../../catalog/opening-state';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'kitchen',
})
@Index(['latitude', 'longitude'])
export class KitchenEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One kitchen per user: the one-to-one join column is unique.
  @OneToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'ownerId' })
  owner?: UserEntity;

  @Column({ type: Number })
  ownerId: number;

  @Column({ type: String })
  name: string;

  @Column({ type: String, nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  coverPhoto: FileSnapshot | null;

  @Column({ type: String })
  fullAddress: string;

  @Column({ type: String })
  district: string;

  @Column({ type: String })
  neighborhood: string;

  // Exact coordinates; the API only hands out rounded ones to customers.
  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: Boolean })
  pickupEnabled: boolean;

  @Column({ type: Boolean })
  deliveryEnabled: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  deliveryTiers: DeliveryTier[];

  // Derived (deliveryRadiusOf) for the discovery query.
  @Column({ type: 'double precision', nullable: true })
  deliveryRadiusKm: number | null;

  @Column({ type: Number, nullable: true })
  freeDeliveryMinKurus: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  hours: KitchenHour[];

  @Column({ type: Boolean, default: false })
  isPaused: boolean;

  @Column({ type: Boolean, default: false })
  isVerified: boolean;

  // Derived (foldTurkish) for search.
  @Column({ type: String })
  searchText: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
```

`src/kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper.ts` — dosyanın tamamı:

```ts
import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { Kitchen } from '../../../../domain/kitchen';
import { KitchenEntity } from '../entities/kitchen.entity';

export class KitchenMapper {
  static toDomain(raw: KitchenEntity): Kitchen {
    return Object.assign(new Kitchen(), {
      id: raw.id,
      ownerId: raw.ownerId,
      name: raw.name,
      description: raw.description,
      coverPhoto: raw.coverPhoto ? toFileType(raw.coverPhoto) : null,
      fullAddress: raw.fullAddress,
      district: raw.district,
      neighborhood: raw.neighborhood,
      latitude: raw.latitude,
      longitude: raw.longitude,
      pickupEnabled: raw.pickupEnabled,
      deliveryEnabled: raw.deliveryEnabled,
      deliveryTiers: raw.deliveryTiers,
      deliveryRadiusKm: raw.deliveryRadiusKm,
      freeDeliveryMinKurus: raw.freeDeliveryMinKurus,
      hours: raw.hours,
      isPaused: raw.isPaused,
      isVerified: raw.isVerified,
      searchText: raw.searchText,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static toPersistence(domain: Partial<Kitchen>): KitchenEntity {
    const { coverPhoto, ownerId, ...fields } = domain;

    return Object.assign(
      new KitchenEntity(),
      fields,
      ownerId === undefined ? {} : { ownerId: Number(ownerId) },
      coverPhoto === undefined
        ? {}
        : { coverPhoto: coverPhoto ? toSnapshot(coverPhoto) : null },
    );
  }
}
```

- [ ] **Step 5: Repository**

`src/kitchens/infrastructure/persistence/kitchen.repository.ts` — dosyanın tamamı:

```ts
import { NullableType } from '../../../utils/types/nullable.type';
import { User } from '../../../users/domain/user';
import { Kitchen } from '../../domain/kitchen';

export abstract class KitchenRepository {
  abstract create(
    data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Kitchen>;

  abstract findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>>;

  abstract update(
    id: Kitchen['id'],
    payload: Partial<Kitchen>,
  ): Promise<Kitchen>;

  abstract softDeleteByOwnerId(ownerId: User['id']): Promise<void>;
}
```

`src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../../../users/domain/user';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Kitchen } from '../../../../domain/kitchen';
import { KitchenRepository } from '../../kitchen.repository';
import { KitchenEntity } from '../entities/kitchen.entity';
import { KitchenMapper } from '../mappers/kitchen.mapper';

@Injectable()
export class KitchenRelationalRepository implements KitchenRepository {
  constructor(
    @InjectRepository(KitchenEntity)
    private readonly kitchenRepository: Repository<KitchenEntity>,
  ) {}

  async create(
    data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Kitchen> {
    const entity = await this.kitchenRepository.save(
      this.kitchenRepository.create(KitchenMapper.toPersistence(data)),
    );
    return KitchenMapper.toDomain(entity);
  }

  async findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>> {
    const entity = await this.kitchenRepository.findOne({
      where: { ownerId: Number(ownerId) },
    });
    return entity ? KitchenMapper.toDomain(entity) : null;
  }

  async update(id: Kitchen['id'], payload: Partial<Kitchen>): Promise<Kitchen> {
    await this.kitchenRepository.save(
      this.kitchenRepository.create({
        ...KitchenMapper.toPersistence(payload),
        id,
      }),
    );
    const entity = await this.kitchenRepository.findOneOrFail({
      where: { id },
    });
    return KitchenMapper.toDomain(entity);
  }

  async softDeleteByOwnerId(ownerId: User['id']): Promise<void> {
    await this.kitchenRepository.softDelete({ ownerId: Number(ownerId) });
  }
}
```

- [ ] **Step 6: DTO'lar**

`src/kitchens/dto/create-kitchen.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_DELIVERY_RADIUS_KM } from '../../catalog/delivery';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DeliveryTierDto {
  @ApiProperty({ example: 3 })
  @IsNumber()
  @Min(0.1)
  @Max(MAX_DELIVERY_RADIUS_KM)
  upToKm: number;

  @ApiProperty({ example: 2500, description: 'kuruş' })
  @IsInt()
  @Min(0)
  @Max(100_000)
  feeKurus: number;
}

export class KitchenHourDto {
  @ApiProperty({ example: 1, description: '1 = Pazartesi … 7 = Pazar' })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: '11:00' })
  @Matches(HH_MM, { message: 'invalidTime' })
  opensAt: string;

  @ApiProperty({ example: '20:00' })
  @Matches(HH_MM, { message: 'invalidTime' })
  closesAt: string;
}

export class CreateKitchenDto {
  @ApiProperty({ example: 'Ayşe Teyze Mutfağı' })
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  coverPhotoId?: string | null;

  @ApiProperty({ format: 'uuid', description: 'Kullanıcının adreslerinden biri; kopyalanır' })
  @IsUUID()
  addressId: string;

  @ApiProperty()
  @IsBoolean()
  pickupEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  deliveryEnabled: boolean;

  @ApiProperty({ type: () => DeliveryTierDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => DeliveryTierDto)
  deliveryTiers: DeliveryTierDto[];

  @ApiPropertyOptional({ nullable: true, description: 'kuruş' })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeDeliveryMinKurus?: number | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => KitchenHourDto)
  hours: KitchenHourDto[];
}
```

`src/kitchens/dto/update-kitchen.dto.ts` — dosyanın tamamı:

```ts
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateKitchenDto } from './create-kitchen.dto';

// skipNullProperties: false → `{ "name": null }` is a 422; nullable fields
// (description, coverPhotoId, freeDeliveryMinKurus) keep their @IsOptional().
export class UpdateKitchenDto extends PartialType(CreateKitchenDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isPaused?: boolean;
}
```

Sil: `rm src/kitchens/dto/find-all-kitchens.dto.ts`

- [ ] **Step 7: `AddressesService.findOwned`'u aç**

`src/addresses/addresses.service.ts` — `private findOwned(` satırını şununla değiştir (gövde aynı kalır):

```ts
  /** The caller's address, or 404 (also for someone else's). */
  findOwned(userId: User['id'], id: Address['id']): Promise<Address> {
```

- [ ] **Step 8: Servis — test**

`src/kitchens/kitchens.service.spec.ts`:

```ts
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { Kitchen } from './domain/kitchen';
import { CreateKitchenDto } from './dto/create-kitchen.dto';
import { KitchenRepository } from './infrastructure/persistence/kitchen.repository';
import { KitchensService } from './kitchens.service';

const HOME = Object.assign(new Address(), {
  id: 'a1',
  title: 'Ev',
  fullAddress: 'Caferağa Mh. Moda Cd. No:1',
  district: 'Kadıköy',
  neighborhood: 'Caferağa',
  latitude: 40.9862,
  longitude: 29.0254,
});

const WORK = Object.assign(new Address(), {
  ...HOME,
  id: 'a2',
  district: 'Beşiktaş',
  neighborhood: 'Sinanpaşa',
  latitude: 41.0428,
  longitude: 29.0075,
});

const dto = (overrides: Partial<CreateKitchenDto> = {}): CreateKitchenDto => ({
  name: 'Ayşe Teyze Mutfağı',
  addressId: 'a1',
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 0 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  ...overrides,
});

const build = () => {
  let stored: Kitchen | null = null;
  const repository = {
    create: jest.fn().mockImplementation((data) => {
      stored = Object.assign(new Kitchen(), data, { id: 'k1' });
      return Promise.resolve(stored);
    }),
    findByOwnerId: jest.fn().mockImplementation(() => Promise.resolve(stored)),
    update: jest.fn().mockImplementation((id, data) => {
      stored = Object.assign(new Kitchen(), data, { id });
      return Promise.resolve(stored);
    }),
    softDeleteByOwnerId: jest.fn(),
  };
  const addresses = {
    findOwned: jest
      .fn()
      .mockImplementation((_, id) => Promise.resolve(id === 'a2' ? WORK : HOME)),
  };
  const files = { findByIds: jest.fn().mockResolvedValue([]) };
  const service = new KitchensService(
    repository as unknown as KitchenRepository,
    addresses as unknown as AddressesService,
    files as unknown as FilesService,
  );
  return { service, repository, addresses, files };
};

describe('KitchensService.create', () => {
  it('should copy the address and derive radius and search text', async () => {
    const { service, addresses } = build();

    const kitchen = await service.create(7, dto());

    expect(addresses.findOwned).toHaveBeenCalledWith(7, 'a1');
    expect(kitchen).toMatchObject({
      ownerId: 7,
      fullAddress: HOME.fullAddress,
      district: 'Kadıköy',
      latitude: 40.9862,
      longitude: 29.0254,
      description: null,
      coverPhoto: null,
      freeDeliveryMinKurus: null,
      isPaused: false,
      isVerified: false,
      deliveryRadiusKm: 5,
      searchText: 'ayse teyze mutfagi kadikoy caferaga',
    });
  });

  it('should refuse a second kitchen', async () => {
    const { service } = build();
    await service.create(7, dto());

    await expect(service.create(7, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('should enforce the cross-field rules', async () => {
    const { service } = build();

    await expect(
      service.create(7, dto({ pickupEnabled: false, deliveryEnabled: false })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should snapshot an existing cover photo and reject a missing one', async () => {
    const { service, files } = build();
    const cover = Object.assign(new FileType(), { id: 'f1', path: '/f1.png' });

    await expect(
      service.create(7, dto({ coverPhotoId: 'missing' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    files.findByIds.mockResolvedValue([cover]);
    const kitchen = await service.create(7, dto({ coverPhotoId: 'f1' }));
    expect(kitchen.coverPhoto).toEqual(cover);
  });
});

describe('KitchensService.update', () => {
  it('should merge changes and recompute derived fields', async () => {
    const { service } = build();
    await service.create(7, dto());

    const kitchen = await service.update(7, {
      isPaused: true,
      deliveryEnabled: false,
    });

    expect(kitchen).toMatchObject({
      name: 'Ayşe Teyze Mutfağı',
      isPaused: true,
      deliveryEnabled: false,
      deliveryRadiusKm: null,
      deliveryTiers: dto().deliveryTiers,
    });
  });

  it('should re-copy the address when addressId changes', async () => {
    const { service, addresses } = build();
    await service.create(7, dto());

    const kitchen = await service.update(7, { addressId: 'a2' });

    expect(addresses.findOwned).toHaveBeenLastCalledWith(7, 'a2');
    expect(kitchen).toMatchObject({
      district: 'Beşiktaş',
      latitude: 41.0428,
      searchText: 'ayse teyze mutfagi besiktas sinanpasa',
    });
  });

  it('should 404 without a kitchen', async () => {
    const { service } = build();

    await expect(service.update(7, { isPaused: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Run: `npx jest src/kitchens/kitchens.service.spec.ts` → FAIL.

- [ ] **Step 9: Servis — kod**

`src/kitchens/kitchens.service.ts` — dosyanın tamamı:

```ts
import {
  ConflictException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { assertNoFieldErrors } from '../catalog/field-errors';
import { foldTurkish } from '../catalog/fold-turkish';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { Kitchen } from './domain/kitchen';
import { CreateKitchenDto } from './dto/create-kitchen.dto';
import { UpdateKitchenDto } from './dto/update-kitchen.dto';
import { KitchenRepository } from './infrastructure/persistence/kitchen.repository';
import { deliveryRadiusOf, kitchenRuleErrors } from './kitchen-rules';

/** What the cook controls; deliveryRadiusKm and searchText derive from it. */
type KitchenFields = Omit<
  Kitchen,
  'id' | 'createdAt' | 'updatedAt' | 'deliveryRadiusKm' | 'searchText'
>;

const addressFields = (address: Address) => ({
  fullAddress: address.fullAddress,
  district: address.district,
  neighborhood: address.neighborhood,
  latitude: address.latitude,
  longitude: address.longitude,
});

@Injectable()
export class KitchensService {
  constructor(
    private readonly kitchenRepository: KitchenRepository,
    private readonly addressesService: AddressesService,
    private readonly filesService: FilesService,
  ) {}

  findByOwner(ownerId: User['id']): Promise<Kitchen | null> {
    return this.kitchenRepository.findByOwnerId(ownerId);
  }

  findMine(ownerId: User['id']): Promise<Kitchen> {
    return orNotFound(this.kitchenRepository.findByOwnerId(ownerId));
  }

  async create(ownerId: User['id'], dto: CreateKitchenDto): Promise<Kitchen> {
    if (await this.kitchenRepository.findByOwnerId(ownerId)) {
      throw new ConflictException({
        status: HttpStatus.CONFLICT,
        error: 'kitchenAlreadyExists',
      });
    }

    const address = await this.addressesService.findOwned(
      ownerId,
      dto.addressId,
    );

    return this.kitchenRepository.create(
      this.withDerived({
        ownerId,
        name: dto.name,
        description: dto.description ?? null,
        coverPhoto: await this.coverPhoto(dto.coverPhotoId),
        ...addressFields(address),
        pickupEnabled: dto.pickupEnabled,
        deliveryEnabled: dto.deliveryEnabled,
        deliveryTiers: dto.deliveryTiers,
        freeDeliveryMinKurus: dto.freeDeliveryMinKurus ?? null,
        hours: dto.hours,
        isPaused: false,
        isVerified: false,
      }),
    );
  }

  async update(ownerId: User['id'], dto: UpdateKitchenDto): Promise<Kitchen> {
    const current = await this.findMine(ownerId);
    const { addressId, coverPhotoId, ...changes } = dto;
    const next: KitchenFields = { ...current, ...changes };

    if (addressId !== undefined) {
      Object.assign(
        next,
        addressFields(await this.addressesService.findOwned(ownerId, addressId)),
      );
    }

    if (coverPhotoId !== undefined) {
      next.coverPhoto = await this.coverPhoto(coverPhotoId);
    }

    return this.kitchenRepository.update(current.id, this.withDerived(next));
  }

  /** Account deletion; products go first (ProductsService.removeAllForOwner). */
  removeForOwner(ownerId: User['id']): Promise<void> {
    return this.kitchenRepository.softDeleteByOwnerId(ownerId);
  }

  private withDerived(
    fields: KitchenFields,
  ): KitchenFields & Pick<Kitchen, 'deliveryRadiusKm' | 'searchText'> {
    assertNoFieldErrors(kitchenRuleErrors(fields));

    return {
      ...fields,
      deliveryRadiusKm: deliveryRadiusOf(fields),
      searchText: foldTurkish(
        [fields.name, fields.description, fields.district, fields.neighborhood]
          .filter(Boolean)
          .join(' '),
      ),
    };
  }

  private async coverPhoto(
    id: string | null | undefined,
  ): Promise<FileType | null> {
    if (!id) {
      return null;
    }

    const [file] = await this.filesService.findByIds([id]);

    if (!file) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { coverPhotoId: 'imageNotExists' },
      });
    }

    return file;
  }
}
```

Run: `npx jest src/kitchens/kitchens.service.spec.ts` → PASS (7 test).

- [ ] **Step 10: Controller ve modül**

`src/kitchens/kitchens.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { Kitchen } from './domain/kitchen';
import { CreateKitchenDto } from './dto/create-kitchen.dto';
import { UpdateKitchenDto } from './dto/update-kitchen.dto';
import { KitchensService } from './kitchens.service';

/** The signed-in cook's kitchen; customers read kitchens via /discover. */
@ApiTags('Kitchens')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me',
  version: '1',
})
export class KitchensController {
  constructor(private readonly kitchensService: KitchensService) {}

  @Post()
  @ApiCreatedResponse({ type: Kitchen })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: CreateKitchenDto,
  ): Promise<Kitchen> {
    return this.kitchensService.create(request.user.id, dto);
  }

  @Get()
  @ApiOkResponse({ type: Kitchen })
  findMine(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<Kitchen> {
    return this.kitchensService.findMine(request.user.id);
  }

  @Patch()
  @ApiOkResponse({ type: Kitchen })
  update(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: UpdateKitchenDto,
  ): Promise<Kitchen> {
    return this.kitchensService.update(request.user.id, dto);
  }
}
```

`src/kitchens/kitchens.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { FilesModule } from '../files/files.module';
import { RelationalKitchenPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { KitchensController } from './kitchens.controller';
import { KitchensService } from './kitchens.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalKitchenPersistenceModule,
    AddressesModule,
    FilesModule,
  ],
  controllers: [KitchensController],
  providers: [KitchensService],
  exports: [KitchensService, RelationalKitchenPersistenceModule],
})
export class KitchensModule {}
```

(Generator'ın ürettiği persistence modülünün adı farklıysa importu ona göre düzelt.)

- [ ] **Step 11: Migration**

```bash
npm run build
npm run migration:generate -- src/database/migrations/CreateKitchen
npm run migration:run
```

Expected: `CREATE TABLE "kitchen"` (jsonb sütunlar, `deletedAt`), `ownerId` unique constraint, `(latitude, longitude)` index, `user`'a FK. Başka tabloya dokunan ifade varsa DURUP bildir.

- [ ] **Step 12: `hasKitchen` — test**

`src/auth/auth.service.spec.ts` — `buildAuthService`'e mutfak mock'u ekle ve yeni testleri dosyanın sonuna koy:

```ts
// buildAuthService içinde, sessions'tan sonra:
  const kitchens = { findByOwner: jest.fn().mockResolvedValue(null) };

// new AuthService(...) argümanlarının sonuna:
    kitchens as unknown as KitchensService,

// return satırı:
  return { service, users, sessions, kitchens };
```

(import: `import { KitchensService } from '../kitchens/kitchens.service';`, `import { JwtPayloadType } from './strategies/types/jwt-payload.type';`)

```ts
describe('AuthService hasKitchen', () => {
  it('should flag the user on /auth/me', async () => {
    const { service, users, kitchens } = buildAuthService();
    users.findById.mockResolvedValue(aUser());
    kitchens.findByOwner.mockResolvedValue({ id: 'k1' });

    await expect(
      service.me({ id: 7 } as JwtPayloadType),
    ).resolves.toMatchObject({ hasKitchen: true });
    expect(kitchens.findByOwner).toHaveBeenCalledWith(7);
  });

  it('should flag the user in login responses', async () => {
    const { service, users } = buildAuthService();
    users.findByPhoneNumber.mockResolvedValue(aUser());

    const result = await service.validatePhoneLogin('+905551112233');

    expect(result.user.hasKitchen).toBe(false);
  });
});
```

Run: `npx jest src/auth/auth.service.spec.ts` → FAIL (`hasKitchen` undefined; TS: fazladan constructor argümanı).

- [ ] **Step 13: `hasKitchen` — kod**

`src/auth/auth.service.ts`:
- import: `import { KitchensService } from '../kitchens/kitchens.service';`
- constructor parametrelerinin sonuna: `private readonly kitchensService: KitchensService,`
- `me` içindeki `return user;` → `return this.withKitchenFlag(user);`
- `update`'in son satırı:

```ts
    const updated = await this.usersService.findById(userJwtPayload.id);
    return updated && this.withKitchenFlag(updated);
```

- `createLoginResponse`'un son satırı:

```ts
    return {
      refreshToken,
      token,
      tokenExpires,
      user: await this.withKitchenFlag(user),
    };
```

- Sınıfın sonuna:

```ts
  /** `hasKitchen` is derived, so every response that carries the user sets it. */
  private async withKitchenFlag(user: User): Promise<User> {
    user.hasKitchen =
      (await this.kitchensService.findByOwner(user.id)) !== null;
    return user;
  }
```

`src/auth/auth.module.ts` — `imports` dizisine `KitchensModule` ekle (`import { KitchensModule } from '../kitchens/kitchens.module';`).

Run: `npx jest src/auth` → PASS.

- [ ] **Step 14: e2e — test dosyasını oluştur**

`test/user/catalog.e2e-spec.ts`:

```ts
import { beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

// 1×1 PNG; the local file driver accepts .png uploads.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const uniquePhone = (prefix: string) =>
  `${prefix}${String(Date.now()).slice(-7)}`;

const phoneLogin = async (phoneNumber: string): Promise<string> => {
  const { body } = await request(APP_URL)
    .post('/api/v1/auth/phone/login')
    .send({ idToken: `dev:${phoneNumber}` })
    .expect(200);
  return body.data.token;
};

const uploadPng = async (token: string): Promise<string> => {
  const { body } = await request(APP_URL)
    .post('/api/v1/files/upload')
    .auth(token, { type: 'bearer' })
    .attach('file', PNG, 'dish.png')
    .expect(201);
  return body.data.file.id;
};

// A fresh spot per run, away from the Kadıköy dev seed and earlier runs.
const HOME = { latitude: 37 + Math.random(), longitude: 30 + Math.random() };

/** Discovery query params `km` kilometres north of HOME. */
const north = (km: number) => ({
  lat: HOME.latitude + km / 111.19,
  lng: HOME.longitude,
});

const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '00:00',
  closesAt: '23:59',
}));

describe('Catalog: kitchens, products and discovery', () => {
  const app = APP_URL;
  let cook: string;
  let customer: string;
  let addressId: string;
  let coverId: string;
  let kitchenId: string;

  const kitchenBody = () => ({
    name: 'Test Mutfağı',
    description: 'Ev yemekleri',
    coverPhotoId: coverId,
    addressId,
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryTiers: [
      { upToKm: 2, feeKurus: 0 },
      { upToKm: 5, feeKurus: 2500 },
    ],
    hours: ALL_WEEK,
  });

  beforeAll(async () => {
    cook = await phoneLogin(uniquePhone('+90556'));
    customer = await phoneLogin(uniquePhone('+90557'));
  });

  it('should 404 /kitchens/me before the kitchen exists', () =>
    request(app)
      .get('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .expect(404));

  it('should report hasKitchen: false', () =>
    request(app)
      .get('/api/v1/auth/me')
      .auth(cook, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.hasKitchen).toBe(false);
      }));

  it('should prepare an address and a cover photo', async () => {
    const { body } = await request(app)
      .post('/api/v1/addresses')
      .auth(cook, { type: 'bearer' })
      .send({
        title: 'Ev',
        fullAddress: 'Deneme Mh. Test Sk. No:1',
        district: 'Merkez',
        neighborhood: 'Deneme',
        ...HOME,
      })
      .expect(201);
    addressId = body.data.id;
    coverId = await uploadPng(cook);
  });

  it('should reject cross-field kitchen rules with dotted field errors', () =>
    request(app)
      .post('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({
        ...kitchenBody(),
        deliveryTiers: [
          { upToKm: 3, feeKurus: 0 },
          { upToKm: 2, feeKurus: 1000 },
        ],
        hours: [
          { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
          { dayOfWeek: 1, opensAt: '13:00', closesAt: '15:00' },
        ],
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body.errors).toEqual(
          expect.arrayContaining([
            { field: 'deliveryTiers.1.upToKm', message: 'mustIncrease' },
            { field: 'hours.1.opensAt', message: 'overlaps' },
          ]),
        );
      }));

  it('should open the kitchen with a copy of the address', () =>
    request(app)
      .post('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send(kitchenBody())
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          name: 'Test Mutfağı',
          district: 'Merkez',
          latitude: HOME.latitude,
          longitude: HOME.longitude,
          isPaused: false,
          isVerified: false,
          coverPhoto: { id: coverId },
        });
        expect(body.data.coverPhoto.path).toMatch(/^https?:\/\//);
        expect(body.data).not.toHaveProperty('searchText');
        expect(body.data).not.toHaveProperty('deliveryRadiusKm');
        expect(body.data).not.toHaveProperty('ownerId');
        kitchenId = body.data.id;
      }));

  it('should refuse a second kitchen', () =>
    request(app)
      .post('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send(kitchenBody())
      .expect(409));

  it('should pause and resume the kitchen', async () => {
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ isPaused: true, name: 'Test Mutfağı' });
      });

    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: false })
      .expect(200);
  });

  it('should reject an explicit null for a required field', () =>
    request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ name: null })
      .expect(422));

  it('should report hasKitchen: true', () =>
    request(app)
      .get('/api/v1/auth/me')
      .auth(cook, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.hasKitchen).toBe(true);
      }));

  it('should 404 kitchen edits from a user without a kitchen', () =>
    request(app)
      .patch('/api/v1/kitchens/me')
      .auth(customer, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(404));

  // TASK-5-PRODUCTS
  // TASK-6-DISCOVERY
});
```

(`ADMIN_EMAIL`/`ADMIN_PASSWORD` Task 5'te kullanılır; o zamana kadar lint "unused" uyarısı verirse importtan çıkar, Task 5'te geri ekle.)

Run: `npm run test:e2e -- --runInBand test/user/catalog.e2e-spec.ts`
Expected: PASS (10 test).

- [ ] **Step 15: Tüm paket ve commit**

Run: `npm test && npm run lint && npm run test:e2e -- --runInBand`
Expected: PASS.

```bash
git add src/kitchens src/addresses/addresses.service.ts src/auth src/app.module.ts src/database/migrations test/user/catalog.e2e-spec.ts
git commit -m "feat(kitchens): open and manage the cook's kitchen

- one kitchen per user, address copied from the address book
- delivery tiers and weekly hours as jsonb, validated across fields
- hasKitchen on /auth/me and login responses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Ürünler (`/api/v1/kitchens/me/products`) + hesap silme

**Files:**
- Generate: `src/products/**`, `src/app.module.ts`
- Modify (generator sonrası, son halleri aşağıda): `src/products/domain/product.ts`, `src/products/infrastructure/persistence/relational/entities/product.entity.ts`, `src/products/infrastructure/persistence/relational/mappers/product.mapper.ts`, `src/products/infrastructure/persistence/product.repository.ts`, `src/products/infrastructure/persistence/relational/repositories/product.repository.ts`, `src/products/dto/create-product.dto.ts`, `src/products/dto/update-product.dto.ts`, `src/products/products.service.ts`, `src/products/products.controller.ts`, `src/products/products.module.ts`
- Delete: `src/products/dto/find-all-products.dto.ts`
- Create: `src/products/product-rules.ts`, `src/products/product-rules.spec.ts`, `src/products/products.service.spec.ts`
- Modify: `src/users/users.service.ts`, `src/users/users.service.spec.ts`, `src/users/users.module.ts`, `test/user/catalog.e2e-spec.ts`
- Create (generate): `src/database/migrations/<timestamp>-CreateProduct.ts`

**Interfaces:**
- Consumes: Task 1 (`Allergen`, `DietTag`, `SaleType`, `foldTurkish`, `assertNoFieldErrors`, `FieldErrors`, `toSnapshot`, `toFileType`, `FileSnapshot`), Task 2 (`Category`, `CategoryEntity`, `CategoryMapper`, `CategoriesService.findActive`), Task 4 (`Kitchen`, `KitchenEntity`, `KitchensService.findMine`, `KitchensService.findByOwner`, `KitchensService.removeForOwner`).
- Produces:
  - `Product` domain: `{ id: string; kitchenId: string; category: Category; name: string; description: string | null; priceKurus: number; saleType: SaleType; prepMinutes: number | null; portionsAvailable: number | null; allergens: Allergen[]; dietTags: DietTag[]; photos: FileType[]; isActive: boolean; searchText: string; createdAt: Date; updatedAt: Date }` — `searchText` yanıtta görünmez.
  - `ProductEntity` (tablo `product`, soft delete; `category` eager), `ProductMapper.toDomain(raw: ProductEntity): Product`.
  - `normalizeSale(input: SaleInput): { sale: SaleFields; errors: FieldErrors }`.
  - `ProductsService.listMine`, `createMine`, `updateMine`, `removeMine`, `removeAllForOwner(ownerId): Promise<void>`.
  - `ProductsModule` exports `ProductsService`, `RelationalProductPersistenceModule` (Task 6 `ProductEntity`'yi kullanır).
  - REST: `GET /kitchens/me/products` (en yeni önce), `POST` → 201, `PATCH /:id`, `DELETE /:id` → 204. Mutfak yoksa veya ürün başkasınınsa 404. Bilinmeyen/pasif kategori → 422 `{ categoryId: 'notExists' }`; olmayan fotoğraf → 422 `{ photoIds: 'imageNotExists' }`.
  - Hesap silme sırası: kullanıcıyı anonimleştir → ürünler → mutfak → adresler → oturumlar.

- [ ] **Step 1: Satış kuralı — test**

`src/products/product-rules.spec.ts`:

```ts
import { SaleType } from '../catalog/catalog.enums';
import { normalizeSale } from './product-rules';

describe('normalizeSale', () => {
  it('should keep prepMinutes and clear portions for on-demand', () => {
    expect(
      normalizeSale({
        saleType: SaleType.onDemand,
        prepMinutes: 45,
        portionsAvailable: 10,
      }),
    ).toEqual({
      sale: { saleType: SaleType.onDemand, prepMinutes: 45, portionsAvailable: null },
      errors: {},
    });
  });

  it('should keep portions and clear prepMinutes for daily portions', () => {
    expect(
      normalizeSale({
        saleType: SaleType.dailyPortion,
        prepMinutes: 45,
        portionsAvailable: 0,
      }),
    ).toEqual({
      sale: {
        saleType: SaleType.dailyPortion,
        prepMinutes: null,
        portionsAvailable: 0,
      },
      errors: {},
    });
  });

  it('should require the field that belongs to the sale type', () => {
    expect(normalizeSale({ saleType: SaleType.onDemand }).errors).toEqual({
      prepMinutes: 'required',
    });
    expect(
      normalizeSale({ saleType: SaleType.dailyPortion, portionsAvailable: null })
        .errors,
    ).toEqual({ portionsAvailable: 'required' });
  });
});
```

Run: `npx jest src/products/product-rules.spec.ts` → FAIL.

- [ ] **Step 2: Satış kuralı — kod**

`src/products/product-rules.ts`:

```ts
import { SaleType } from '../catalog/catalog.enums';
import { FieldErrors } from '../catalog/field-errors';

export type SaleInput = {
  saleType: SaleType;
  prepMinutes?: number | null;
  portionsAvailable?: number | null;
};

export type SaleFields = {
  saleType: SaleType;
  prepMinutes: number | null;
  portionsAvailable: number | null;
};

/**
 * The field that belongs to the sale type is required; the other one is
 * cleared, so switching types never needs the client to null the old field.
 */
export function normalizeSale(input: SaleInput): {
  sale: SaleFields;
  errors: FieldErrors;
} {
  const prepMinutes = input.prepMinutes ?? null;
  const portionsAvailable = input.portionsAvailable ?? null;

  if (input.saleType === SaleType.onDemand) {
    return {
      sale: { saleType: input.saleType, prepMinutes, portionsAvailable: null },
      errors: prepMinutes === null ? { prepMinutes: 'required' } : {},
    };
  }

  return {
    sale: { saleType: input.saleType, prepMinutes: null, portionsAvailable },
    errors: portionsAvailable === null ? { portionsAvailable: 'required' } : {},
  };
}
```

Run: `npx jest src/products/product-rules.spec.ts` → PASS (3 test).

- [ ] **Step 3: Resource'u ve alanları generator ile üret (sırayla)**

```bash
npm run generate:resource:relational -- --name Product
npm run add:property:to-relational -- --name Product --property kitchen --kind reference --type Kitchen --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Product --property category --kind reference --type Category --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad true
npm run add:property:to-relational -- --name Product --property name --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Product --property description --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Product --property priceKurus --kind primitive --type number --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Product --property saleType --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Product --property prepMinutes --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Product --property portionsAvailable --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Product --property allergens --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Product --property dietTags --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Product --property photos --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Product --property isActive --kind primitive --type boolean --isAddToDto true --isOptional true --isNullable false
npm run add:property:to-relational -- --name Product --property searchText --kind primitive --type string --isAddToDto false --isOptional false
```

Kontrol: `git status` → `src/products/` yeni, `src/app.module.ts`'te `ProductsModule`.

- [ ] **Step 4: Domain, entity, mapper**

`src/products/domain/product.ts` — dosyanın tamamı:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { Allergen, DietTag, SaleType } from '../../catalog/catalog.enums';
import { Category } from '../../categories/domain/category';
import { FileType } from '../../files/domain/file';

export class Product {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  kitchenId: string;

  @ApiProperty({ type: () => Category })
  category: Category;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  priceKurus: number;

  @ApiProperty({ enum: SaleType })
  saleType: SaleType;

  @ApiProperty({ type: Number, nullable: true })
  prepMinutes: number | null;

  @ApiProperty({ type: Number, nullable: true })
  portionsAvailable: number | null;

  @ApiProperty({ enum: Allergen, isArray: true })
  allergens: Allergen[];

  @ApiProperty({ enum: DietTag, isArray: true })
  dietTags: DietTag[];

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];

  @ApiProperty({ type: Boolean })
  isActive: boolean;

  @Exclude({ toPlainOnly: true })
  searchText: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
```

`src/products/infrastructure/persistence/relational/entities/product.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  Allergen,
  DietTag,
  SaleType,
} from '../../../../../catalog/catalog.enums';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { CategoryEntity } from '../../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'product',
})
export class ProductEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Index()
  @Column({ type: 'uuid' })
  kitchenId: string;

  @ManyToOne(() => CategoryEntity, { eager: true, nullable: false })
  @JoinColumn({ name: 'categoryId' })
  category: CategoryEntity;

  @Column({ type: 'uuid' })
  categoryId: string;

  @Column({ type: String })
  name: string;

  @Column({ type: String, nullable: true })
  description: string | null;

  @Column({ type: Number })
  priceKurus: number;

  @Column({ type: String })
  saleType: SaleType;

  @Column({ type: Number, nullable: true })
  prepMinutes: number | null;

  @Column({ type: Number, nullable: true })
  portionsAvailable: number | null;

  @Column({ type: 'simple-array', default: '' })
  allergens: Allergen[];

  @Column({ type: 'simple-array', default: '' })
  dietTags: DietTag[];

  // Ordered gallery; the first one is the card photo.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: FileSnapshot[];

  @Column({ type: Boolean, default: true })
  isActive: boolean;

  // Derived (foldTurkish) for search.
  @Column({ type: String })
  searchText: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
```

`src/products/infrastructure/persistence/relational/mappers/product.mapper.ts` — dosyanın tamamı:

```ts
import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { CategoryMapper } from '../../../../../categories/infrastructure/persistence/relational/mappers/category.mapper';
import { Product } from '../../../../domain/product';
import { ProductEntity } from '../entities/product.entity';

export class ProductMapper {
  /** Expects `category` loaded (eager on find, joined in query builders). */
  static toDomain(raw: ProductEntity): Product {
    return Object.assign(new Product(), {
      id: raw.id,
      kitchenId: raw.kitchenId,
      category: CategoryMapper.toDomain(raw.category),
      name: raw.name,
      description: raw.description,
      priceKurus: raw.priceKurus,
      saleType: raw.saleType,
      prepMinutes: raw.prepMinutes,
      portionsAvailable: raw.portionsAvailable,
      allergens: raw.allergens,
      dietTags: raw.dietTags,
      photos: raw.photos.map(toFileType),
      isActive: raw.isActive,
      searchText: raw.searchText,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  /** Writes the category through its id column; the relation stays unset. */
  static toPersistence(domain: Partial<Product>): ProductEntity {
    const { category, photos, ...fields } = domain;

    return Object.assign(
      new ProductEntity(),
      fields,
      category === undefined ? {} : { categoryId: category.id },
      photos === undefined ? {} : { photos: photos.map(toSnapshot) },
    );
  }
}
```

- [ ] **Step 5: Repository**

`src/products/infrastructure/persistence/product.repository.ts` — dosyanın tamamı:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { NullableType } from '../../../utils/types/nullable.type';
import { Product } from '../../domain/product';

export abstract class ProductRepository {
  abstract create(
    data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Product>;

  /** Newest first. */
  abstract findByKitchenId(kitchenId: Kitchen['id']): Promise<Product[]>;

  abstract findOwned(
    kitchenId: Kitchen['id'],
    id: Product['id'],
  ): Promise<NullableType<Product>>;

  abstract update(
    id: Product['id'],
    payload: Partial<Product>,
  ): Promise<Product>;

  abstract softDelete(id: Product['id']): Promise<void>;

  abstract softDeleteByKitchenId(kitchenId: Kitchen['id']): Promise<void>;
}
```

`src/products/infrastructure/persistence/relational/repositories/product.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Product } from '../../../../domain/product';
import { ProductRepository } from '../../product.repository';
import { ProductEntity } from '../entities/product.entity';
import { ProductMapper } from '../mappers/product.mapper';

@Injectable()
export class ProductRelationalRepository implements ProductRepository {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}

  async create(
    data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Product> {
    const saved = await this.productRepository.save(
      this.productRepository.create(ProductMapper.toPersistence(data)),
    );
    return this.reload(saved.id);
  }

  async findByKitchenId(kitchenId: Kitchen['id']): Promise<Product[]> {
    const entities = await this.productRepository.find({
      where: { kitchenId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => ProductMapper.toDomain(entity));
  }

  async findOwned(
    kitchenId: Kitchen['id'],
    id: Product['id'],
  ): Promise<NullableType<Product>> {
    const entity = await this.productRepository.findOne({
      where: { id, kitchenId },
    });
    return entity ? ProductMapper.toDomain(entity) : null;
  }

  async update(id: Product['id'], payload: Partial<Product>): Promise<Product> {
    await this.productRepository.save(
      this.productRepository.create({
        ...ProductMapper.toPersistence(payload),
        id,
      }),
    );
    return this.reload(id);
  }

  async softDelete(id: Product['id']): Promise<void> {
    await this.productRepository.softDelete(id);
  }

  async softDeleteByKitchenId(kitchenId: Kitchen['id']): Promise<void> {
    await this.productRepository.softDelete({ kitchenId });
  }

  /** save() does not reload the eager category; read the row back. */
  private async reload(id: Product['id']): Promise<Product> {
    const entity = await this.productRepository.findOneOrFail({
      where: { id },
    });
    return ProductMapper.toDomain(entity);
  }
}
```

- [ ] **Step 6: DTO'lar**

`src/products/dto/create-product.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Allergen, DietTag, SaleType } from '../../catalog/catalog.enums';

export class CreateProductDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'Ev usulü mantı' })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty({ example: 14000, description: 'kuruş' })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  priceKurus: number;

  @ApiProperty({ enum: SaleType })
  @IsEnum(SaleType)
  saleType: SaleType;

  @ApiPropertyOptional({ nullable: true, description: 'on_demand için zorunlu' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  prepMinutes?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'daily_portion için zorunlu',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  portionsAvailable?: number | null;

  @ApiProperty({ enum: Allergen, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Allergen, { each: true })
  allergens: Allergen[];

  @ApiProperty({ enum: DietTag, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(DietTag, { each: true })
  dietTags: DietTag[];

  @ApiProperty({ type: [String], description: 'Galeri sırası; ilki kart fotoğrafı' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds: string[];

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
```

`src/products/dto/update-product.dto.ts` — dosyanın tamamı:

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

// skipNullProperties: false → `{ "name": null }` is a 422; nullable fields
// (description, prepMinutes, portionsAvailable) keep their @IsOptional().
export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {}
```

Sil: `rm src/products/dto/find-all-products.dto.ts`

- [ ] **Step 7: Servis — test**

`src/products/products.service.spec.ts`:

```ts
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Allergen, DietTag, SaleType } from '../catalog/catalog.enums';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { Product } from './domain/product';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductRepository } from './infrastructure/persistence/product.repository';
import { ProductsService } from './products.service';

const KITCHEN = Object.assign(new Kitchen(), { id: 'k1', ownerId: 7 });
const MAIN = Object.assign(new Category(), { id: 'c1', isActive: true });
const file = (id: string) => Object.assign(new FileType(), { id, path: `/${id}.png` });

const dto = (overrides: Partial<CreateProductDto> = {}): CreateProductDto => ({
  categoryId: 'c1',
  name: 'Ev Usulü Mantı',
  description: 'Yoğurtlu',
  priceKurus: 14000,
  saleType: SaleType.onDemand,
  prepMinutes: 45,
  allergens: [Allergen.milk, Allergen.gluten],
  dietTags: [],
  photoIds: ['f2', 'f1'],
  ...overrides,
});

const build = () => {
  const rows = new Map<string, Product>();
  const repository = {
    create: jest.fn().mockImplementation((data) => {
      const row = Object.assign(new Product(), data, { id: `p${rows.size + 1}` });
      rows.set(row.id, row);
      return Promise.resolve(row);
    }),
    findByKitchenId: jest.fn(),
    findOwned: jest
      .fn()
      .mockImplementation((kitchenId, id) =>
        Promise.resolve(
          rows.get(id)?.kitchenId === kitchenId ? rows.get(id) : null,
        ),
      ),
    update: jest.fn().mockImplementation((id, data) => {
      const row = Object.assign(new Product(), data, { id });
      rows.set(id, row);
      return Promise.resolve(row);
    }),
    softDelete: jest.fn(),
    softDeleteByKitchenId: jest.fn(),
  };
  const kitchens = {
    findMine: jest.fn().mockResolvedValue(KITCHEN),
    findByOwner: jest.fn().mockResolvedValue(KITCHEN),
  };
  const categories = {
    findActive: jest
      .fn()
      .mockImplementation((id) => Promise.resolve(id === 'c1' ? MAIN : null)),
  };
  // The files table returns rows in its own order, not the requested one.
  const files = {
    findByIds: jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(
          ['f1', 'f2'].filter((id) => ids.includes(id)).map(file),
        ),
      ),
  };
  const service = new ProductsService(
    repository as unknown as ProductRepository,
    kitchens as unknown as KitchensService,
    categories as unknown as CategoriesService,
    files as unknown as FilesService,
  );
  return { service, repository, kitchens };
};

describe('ProductsService.createMine', () => {
  it('should build the product from the cook’s kitchen', async () => {
    const { service } = build();

    const product = await service.createMine(7, dto({ portionsAvailable: 3 }));

    expect(product).toMatchObject({
      kitchenId: 'k1',
      category: MAIN,
      prepMinutes: 45,
      portionsAvailable: null,
      isActive: true,
      searchText: 'ev usulu manti yogurtlu',
    });
    expect(product.photos.map((photo) => photo.id)).toEqual(['f2', 'f1']);
  });

  it('should require portions for a daily-portion product', async () => {
    const { service } = build();

    await expect(
      service.createMine(
        7,
        dto({ saleType: SaleType.dailyPortion, dietTags: [DietTag.vegan] }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should reject an unknown or inactive category', async () => {
    const { service } = build();

    await expect(
      service.createMine(7, dto({ categoryId: 'c9' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should reject a missing photo', async () => {
    const { service } = build();

    await expect(
      service.createMine(7, dto({ photoIds: ['f1', 'f9'] })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ProductsService.updateMine', () => {
  it('should clear prepMinutes when switching to daily portions', async () => {
    const { service } = build();
    const created = await service.createMine(7, dto());

    const updated = await service.updateMine(7, created.id, {
      saleType: SaleType.dailyPortion,
      portionsAvailable: 5,
    });

    expect(updated).toMatchObject({
      name: 'Ev Usulü Mantı',
      prepMinutes: null,
      portionsAvailable: 5,
    });
  });

  it('should 404 a product of another kitchen', async () => {
    const { service, kitchens } = build();
    const created = await service.createMine(7, dto());
    kitchens.findMine.mockResolvedValue(
      Object.assign(new Kitchen(), { id: 'k2' }),
    );

    await expect(
      service.updateMine(8, created.id, { priceKurus: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProductsService.removeAllForOwner', () => {
  it('should do nothing for a user without a kitchen', async () => {
    const { service, repository, kitchens } = build();
    kitchens.findByOwner.mockResolvedValue(null);

    await service.removeAllForOwner(7);

    expect(repository.softDeleteByKitchenId).not.toHaveBeenCalled();
  });

  it('should soft-delete every product of the kitchen', async () => {
    const { service, repository } = build();

    await service.removeAllForOwner(7);

    expect(repository.softDeleteByKitchenId).toHaveBeenCalledWith('k1');
  });
});
```

Run: `npx jest src/products/products.service.spec.ts` → FAIL.

- [ ] **Step 8: Servis — kod**

`src/products/products.service.ts` — dosyanın tamamı:

```ts
import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { assertNoFieldErrors } from '../catalog/field-errors';
import { foldTurkish } from '../catalog/fold-turkish';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { Product } from './domain/product';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductRepository } from './infrastructure/persistence/product.repository';
import { normalizeSale } from './product-rules';

/** What the cook controls; searchText derives from it. */
type ProductFields = Omit<
  Product,
  'id' | 'createdAt' | 'updatedAt' | 'searchText'
>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly kitchensService: KitchensService,
    private readonly categoriesService: CategoriesService,
    private readonly filesService: FilesService,
  ) {}

  async listMine(ownerId: User['id']): Promise<Product[]> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return this.productRepository.findByKitchenId(kitchen.id);
  }

  async createMine(
    ownerId: User['id'],
    dto: CreateProductDto,
  ): Promise<Product> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    const { categoryId, photoIds, ...fields } = dto;

    return this.productRepository.create(
      this.withDerived({
        ...fields,
        kitchenId: kitchen.id,
        category: await this.activeCategory(categoryId),
        photos: await this.photos(photoIds),
        description: fields.description ?? null,
        prepMinutes: fields.prepMinutes ?? null,
        portionsAvailable: fields.portionsAvailable ?? null,
        isActive: fields.isActive ?? true,
      }),
    );
  }

  async updateMine(
    ownerId: User['id'],
    id: Product['id'],
    dto: UpdateProductDto,
  ): Promise<Product> {
    const current = await this.findMine(ownerId, id);
    const { categoryId, photoIds, ...changes } = dto;
    const next: ProductFields = { ...current, ...changes };

    if (categoryId !== undefined) {
      next.category = await this.activeCategory(categoryId);
    }

    if (photoIds !== undefined) {
      next.photos = await this.photos(photoIds);
    }

    return this.productRepository.update(id, this.withDerived(next));
  }

  async removeMine(ownerId: User['id'], id: Product['id']): Promise<void> {
    await this.findMine(ownerId, id);
    await this.productRepository.softDelete(id);
  }

  /** Account deletion; runs before KitchensService.removeForOwner. */
  async removeAllForOwner(ownerId: User['id']): Promise<void> {
    const kitchen = await this.kitchensService.findByOwner(ownerId);

    if (kitchen) {
      await this.productRepository.softDeleteByKitchenId(kitchen.id);
    }
  }

  private async findMine(
    ownerId: User['id'],
    id: Product['id'],
  ): Promise<Product> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return orNotFound(this.productRepository.findOwned(kitchen.id, id));
  }

  private withDerived(
    fields: ProductFields,
  ): ProductFields & Pick<Product, 'searchText'> {
    const { sale, errors } = normalizeSale(fields);
    assertNoFieldErrors(errors);

    return {
      ...fields,
      ...sale,
      searchText: foldTurkish(
        [fields.name, fields.description].filter(Boolean).join(' '),
      ),
    };
  }

  private async activeCategory(id: Category['id']): Promise<Category> {
    const category = await this.categoriesService.findActive(id);

    if (!category) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { categoryId: 'notExists' },
      });
    }

    return category;
  }

  /** In the requested order — the first one is the card photo. */
  private async photos(ids: string[]): Promise<FileType[]> {
    const byId = new Map(
      (await this.filesService.findByIds(ids)).map((file) => [file.id, file]),
    );

    if (ids.some((id) => !byId.has(id))) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { photoIds: 'imageNotExists' },
      });
    }

    return ids.map((id) => byId.get(id) as FileType);
  }
}
```

Run: `npx jest src/products/products.service.spec.ts` → PASS (8 test).

- [ ] **Step 9: Controller ve modül**

`src/products/products.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { Product } from './domain/product';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

/** The signed-in cook's menu; customers read products via /discover. */
@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/products',
  version: '1',
})
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOkResponse({ type: Product, isArray: true })
  findAll(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<Product[]> {
    return this.productsService.listMine(request.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: Product })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    return this.productsService.createMine(request.user.id, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: Product })
  update(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    return this.productsService.updateMine(request.user.id, id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.productsService.removeMine(request.user.id, id);
  }
}
```

`src/products/products.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { FilesModule } from '../files/files.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { RelationalProductPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalProductPersistenceModule,
    KitchensModule,
    CategoriesModule,
    FilesModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService, RelationalProductPersistenceModule],
})
export class ProductsModule {}
```

- [ ] **Step 10: Migration**

```bash
npm run build
npm run migration:generate -- src/database/migrations/CreateProduct
npm run migration:run
```

Expected: `CREATE TABLE "product"` (simple-array `text` sütunlar, jsonb `photos`, `deletedAt`), `kitchenId` index, `kitchen` ve `category`'ye FK. Başka tabloya dokunan ifade varsa DURUP bildir.

- [ ] **Step 11: Hesap silme — test**

`src/users/users.service.spec.ts` — `buildUsersService`'i güncelle:

```ts
  const addresses = { removeAllForUser: jest.fn() };
  const sessions = { deleteByUserId: jest.fn() };
  const products = { removeAllForOwner: jest.fn() };
  const kitchens = { removeForOwner: jest.fn() };

  const service = new UsersService(
    repository as unknown as UserRepository,
    {} as FilesService,
    addresses as unknown as AddressesService,
    sessions as unknown as SessionService,
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
  );

  return { service, repository, addresses, sessions, kitchens, products };
```

(importlar: `KitchensService` `../kitchens/kitchens.service`, `ProductsService` `../products/products.service`.)

`UsersService.remove` testini şununla değiştir:

```ts
describe('UsersService.remove', () => {
  it('should anonymize the user, then remove the menu, kitchen, addresses and sessions', async () => {
    const { service, repository, addresses, sessions, kitchens, products } =
      buildUsersService();

    await service.remove(7);

    expect(repository.anonymizeAndSoftDelete).toHaveBeenCalledWith(7);
    expect(products.removeAllForOwner).toHaveBeenCalledWith(7);
    expect(kitchens.removeForOwner).toHaveBeenCalledWith(7);
    expect(addresses.removeAllForUser).toHaveBeenCalledWith(7);
    expect(sessions.deleteByUserId).toHaveBeenCalledWith({ userId: 7 });

    const order = [
      repository.anonymizeAndSoftDelete,
      products.removeAllForOwner,
      kitchens.removeForOwner,
      addresses.removeAllForUser,
      sessions.deleteByUserId,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
```

Run: `npx jest src/users/users.service.spec.ts` → FAIL.

- [ ] **Step 12: Hesap silme — kod**

`src/users/users.service.ts`:
- importlar: `KitchensService`, `ProductsService`.
- constructor'ın sonuna: `private readonly kitchensService: KitchensService,` ve `private readonly productsService: ProductsService,`
- `remove`'u şununla değiştir:

```ts
  /**
   * The only account-deletion path (DELETE /auth/me and admin
   * DELETE /users/:id): anonymize + soft delete the user in one UPDATE, take
   * the menu and kitchen off discovery, hard-delete their addresses (GPS) and
   * end every session, which also revokes outstanding access tokens (see
   * JwtStrategy).
   */
  async remove(id: User['id']): Promise<void> {
    await this.usersRepository.anonymizeAndSoftDelete(id);
    await this.productsService.removeAllForOwner(id);
    await this.kitchensService.removeForOwner(id);
    await this.addressesService.removeAllForUser(id);
    await this.sessionService.deleteByUserId({ userId: id });
  }
```

`src/users/users.module.ts` — `imports`'a `KitchensModule` ve `ProductsModule` ekle.

Run: `npx jest src/users` → PASS. `npm run build` → hatasız (modül döngüsü yok: Products → Kitchens → Addresses/Files; Users → Products/Kitchens).

- [ ] **Step 13: e2e — ürün blokları**

`test/user/catalog.e2e-spec.ts` — `// TASK-5-PRODUCTS` satırını şununla değiştir:

```ts
  let categoryId: string;
  let soupId: string;
  let mantiId: string;
  let kofteId: string;

  it('should list the seeded categories with both names', () =>
    request(app)
      .get('/api/v1/categories')
      .auth(customer, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.length).toBeGreaterThanOrEqual(8);
        expect(body.data[0]).toEqual(
          expect.objectContaining({
            nameTr: expect.any(String),
            nameEn: expect.any(String),
          }),
        );
        categoryId = body.data.find(
          (c: { slug: string }) => c.slug === 'main-dish',
        ).id;
        soupId = body.data.find((c: { slug: string }) => c.slug === 'soup').id;
      }));

  it('should keep category writes to admins', async () => {
    await request(app)
      .post('/api/v1/categories')
      .auth(customer, { type: 'bearer' })
      .send({ slug: `e2e-${Date.now()}`, nameTr: 'Test', nameEn: 'Test' })
      .expect(403);

    const { body } = await request(app)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    await request(app)
      .post('/api/v1/categories')
      .auth(body.data.token, { type: 'bearer' })
      .send({
        slug: `e2e-${Date.now()}`,
        nameTr: 'Test',
        nameEn: 'Test',
        isActive: false,
      })
      .expect(201)
      .expect(({ body: created }) => {
        expect(created.data.isActive).toBe(false);
      });
  });

  it('should require the field that belongs to the sale type', async () =>
    request(app)
      .post('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Mercimek Köftesi',
        priceKurus: 9000,
        saleType: 'daily_portion',
        allergens: [],
        dietTags: ['vegan'],
        photoIds: [await uploadPng(cook)],
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body.errors).toEqual([
          { field: 'portionsAvailable', message: 'required' },
        ]);
      }));

  it('should add an on-demand product and clear the other sale field', async () => {
    const photoIds = [await uploadPng(cook), await uploadPng(cook)];

    const { body } = await request(app)
      .post('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Ev Usulü MANTI',
        description: 'Yoğurtlu',
        priceKurus: 14000,
        saleType: 'on_demand',
        prepMinutes: 45,
        portionsAvailable: 10,
        allergens: ['milk', 'gluten'],
        dietTags: [],
        photoIds,
      })
      .expect(201);

    expect(body.data).toMatchObject({
      saleType: 'on_demand',
      prepMinutes: 45,
      portionsAvailable: null,
      isActive: true,
      kitchenId,
      category: { id: categoryId },
    });
    expect(body.data.photos.map((p: { id: string }) => p.id)).toEqual(photoIds);
    expect(body.data).not.toHaveProperty('searchText');
    mantiId = body.data.id;
  });

  it('should add a daily-portion product', async () => {
    const { body } = await request(app)
      .post('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Mercimek Köftesi',
        priceKurus: 9000,
        saleType: 'daily_portion',
        portionsAvailable: 3,
        allergens: [],
        dietTags: ['vegan'],
        photoIds: [await uploadPng(cook)],
      })
      .expect(201);

    expect(body.data).toMatchObject({ prepMinutes: null, portionsAvailable: 3 });
    kofteId = body.data.id;
  });

  it('should list the cook’s products, newest first', () =>
    request(app)
      .get('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.map((p: { id: string }) => p.id)).toEqual([
          kofteId,
          mantiId,
        ]);
      }));

  it('should switch the sale type back and forth', async () => {
    await request(app)
      .patch(`/api/v1/kitchens/me/products/${mantiId}`)
      .auth(cook, { type: 'bearer' })
      .send({ saleType: 'daily_portion', portionsAvailable: 5 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          prepMinutes: null,
          portionsAvailable: 5,
        });
      });

    await request(app)
      .patch(`/api/v1/kitchens/me/products/${mantiId}`)
      .auth(cook, { type: 'bearer' })
      .send({ saleType: 'on_demand', prepMinutes: 45 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          prepMinutes: 45,
          portionsAvailable: null,
        });
      });
  });

  it('should 404 product writes from someone else', () =>
    request(app)
      .patch(`/api/v1/kitchens/me/products/${mantiId}`)
      .auth(customer, { type: 'bearer' })
      .send({ priceKurus: 1 })
      .expect(404));

  // TASK-6-DISCOVERY
```

ve dosyanın sonundaki eski `// TASK-6-DISCOVERY` satırını sil (yalnızca yukarıdaki kalsın). `ADMIN_EMAIL, ADMIN_PASSWORD` importu yerinde olmalı.

Run: `npm run test:e2e -- --runInBand test/user/catalog.e2e-spec.ts`
Expected: PASS (18 test). Kategori testi kırmızıysa `npm run seed:run:relational` çalıştırılmamıştır (Task 2 Step 9).

- [ ] **Step 14: Tüm paket ve commit**

Run: `npm test && npm run lint && npm run test:e2e -- --runInBand`
Expected: PASS.

```bash
git add src/products src/users src/app.module.ts src/database/migrations test/user/catalog.e2e-spec.ts
git commit -m "feat(products): manage the cook's menu; remove it with the account

- sale type keeps its own field and clears the other
- photos kept in request order, category must be active
- account deletion soft-deletes products, then the kitchen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Keşif (`/api/v1/discover/...`)

**Files:**
- Create: `src/discovery/views.ts`, `src/discovery/visibility.ts`, `src/discovery/visibility.spec.ts`, `src/discovery/presenters.ts`, `src/discovery/presenters.spec.ts`, `src/discovery/dto/discover-query.dto.ts`, `src/discovery/discovery.repository.ts`, `src/discovery/discovery.service.ts`, `src/discovery/discovery.controller.ts`, `src/discovery/discovery.module.ts`
- Modify: `src/app.module.ts` (`DiscoveryModule`), `test/user/catalog.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 (hepsi), Task 2 (`Category`), Task 3 (`User.allergenPreferences`), Task 4 (`Kitchen`, `KitchenEntity`, `KitchenMapper`, `DeliveryTierDto`, `KitchenHourDto`), Task 5 (`Product`, `ProductEntity`, `ProductMapper`), `UsersService.findById`, `infinityPagination`, `InfinityPaginationResponse`, `orNotFound`.
- Produces:
  - Görünümler: `KitchenSummary { id, name, district, distanceKm, isOpenNow, opensAt }`; `KitchenCard extends KitchenSummary { coverPhoto, neighborhood, latitude, longitude, isPaused, pickupAvailable, deliveryAvailable, deliveryFeeKurus, freeDeliveryMinKurus, isVerified }`; `ProductCard { id, name, photo, priceKurus, saleType, prepMinutes, portionsAvailable, allergens, dietTags, allergenWarnings, category, kitchen: KitchenSummary }`; `MenuSection { category, products: ProductCard[] }`; `KitchenDetail extends KitchenCard { description, hours, deliveryTiers, sections }`; `ProductDetail extends ProductCard { description, photos, kitchen: KitchenCard }`.
  - `isKitchenReachable(kitchen, distanceKm, pickupRadiusKm): boolean`, `isProductListed(product): boolean` — SQL'deki kuralların aynısı.
  - REST: `GET /discover/kitchens`, `GET /discover/products` (sorgu: `lat`, `lng`, `categoryId?`, `diet?`, `allergenSafe?`, `q?`, `page`, `limit`) → `{ data: T[], hasNextPage }`; `GET /discover/kitchens/:id?lat&lng` → `KitchenDetail`; `GET /discover/products/:id?lat&lng` → `ProductDetail`. Görünmeyen → 404 (mutfak sahibi hariç).

- [ ] **Step 1: Görünüm sınıfları**

`src/discovery/views.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Allergen, DietTag, SaleType } from '../catalog/catalog.enums';
import { DeliveryTier } from '../catalog/delivery';
import { KitchenHour } from '../catalog/opening-state';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import {
  DeliveryTierDto,
  KitchenHourDto,
} from '../kitchens/dto/create-kitchen.dto';

/** What customers see of a kitchen; never the exact address. */
export class KitchenSummary {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: Number, description: '0.1 km hassasiyet' })
  distanceKm: number;

  @ApiProperty({ type: Boolean })
  isOpenNow: boolean;

  @ApiProperty({ type: Date, nullable: true, description: 'Kapalıysa bir sonraki açılış' })
  opensAt: Date | null;
}

export class KitchenCard extends KitchenSummary {
  @ApiProperty({ type: () => FileType, nullable: true })
  coverPhoto: FileType | null;

  @ApiProperty({ type: String })
  neighborhood: string;

  @ApiProperty({ type: Number, description: 'Yuvarlanmış' })
  latitude: number;

  @ApiProperty({ type: Number, description: 'Yuvarlanmış' })
  longitude: number;

  @ApiProperty({ type: Boolean })
  isPaused: boolean;

  @ApiProperty({ type: Boolean })
  pickupAvailable: boolean;

  @ApiProperty({ type: Boolean })
  deliveryAvailable: boolean;

  @ApiProperty({ type: Number, nullable: true, description: 'Bu konuma, kuruş' })
  deliveryFeeKurus: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  freeDeliveryMinKurus: number | null;

  @ApiProperty({ type: Boolean })
  isVerified: boolean;
}

export class ProductCard {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: () => FileType, nullable: true })
  photo: FileType | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  priceKurus: number;

  @ApiProperty({ enum: SaleType })
  saleType: SaleType;

  @ApiProperty({ type: Number, nullable: true })
  prepMinutes: number | null;

  @ApiProperty({ type: Number, nullable: true })
  portionsAvailable: number | null;

  @ApiProperty({ enum: Allergen, isArray: true })
  allergens: Allergen[];

  @ApiProperty({ enum: DietTag, isArray: true })
  dietTags: DietTag[];

  @ApiProperty({
    enum: Allergen,
    isArray: true,
    description: 'Ürün alerjenleri ∩ kullanıcının tercihleri',
  })
  allergenWarnings: Allergen[];

  @ApiProperty({ type: () => Category })
  category: Category;

  @ApiProperty({ type: () => KitchenSummary })
  kitchen: KitchenSummary;
}

export class MenuSection {
  @ApiProperty({ type: () => Category })
  category: Category;

  @ApiProperty({ type: () => ProductCard, isArray: true })
  products: ProductCard[];
}

export class KitchenDetail extends KitchenCard {
  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  hours: KitchenHour[];

  @ApiProperty({ type: () => DeliveryTierDto, isArray: true })
  deliveryTiers: DeliveryTier[];

  @ApiProperty({ type: () => MenuSection, isArray: true })
  sections: MenuSection[];
}

export class ProductDetail extends ProductCard {
  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];

  // Narrows ProductCard.kitchen (a KitchenSummary) to the full card.
  @ApiProperty({ type: () => KitchenCard })
  kitchen: KitchenCard;
}
```

- [ ] **Step 2: Görünürlük — test ve kod**

`src/discovery/visibility.spec.ts`:

```ts
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
    expect(
      isProductListed({ ...product, category: { isActive: false } }),
    ).toBe(false);
  });

  it('should hide sold-out daily portions', () => {
    const daily = { ...product, saleType: SaleType.dailyPortion };
    expect(isProductListed({ ...daily, portionsAvailable: 0 })).toBe(false);
    expect(isProductListed({ ...daily, portionsAvailable: 1 })).toBe(true);
  });
});
```

Run: `npx jest src/discovery/visibility.spec.ts` → FAIL.

`src/discovery/visibility.ts`:

```ts
import { SaleType } from '../catalog/catalog.enums';
import { Category } from '../categories/domain/category';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';

/** Mirrors `whereReachable` in DiscoveryRepository — keep them in step. */
export function isKitchenReachable(
  kitchen: Pick<Kitchen, 'pickupEnabled' | 'deliveryEnabled' | 'deliveryRadiusKm'>,
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
```

Run: `npx jest src/discovery/visibility.spec.ts` → PASS (6 test).

- [ ] **Step 3: Kartlar — test**

`src/discovery/presenters.spec.ts` (2026-10-12 Pazartesi; İstanbul 12:30):

```ts
import { Allergen, SaleType } from '../catalog/catalog.enums';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
import {
  ViewerContext,
  kitchenCard,
  kitchenDetail,
  productCard,
  productDetail,
} from './presenters';

const NOW = new Date('2026-10-12T09:30:00Z');

const ctx: ViewerContext = {
  userId: 9,
  allergenPreferences: [Allergen.milk],
  point: { latitude: 40.99, longitude: 29.02 },
  pickupRadiusKm: 5,
  coordPrecision: 3,
  now: NOW,
};

const kitchen = Object.assign(new Kitchen(), {
  id: 'k1',
  ownerId: 7,
  name: 'Ayşe Teyze Mutfağı',
  description: 'Ev yemekleri',
  coverPhoto: null,
  fullAddress: 'Caferağa Mh. Moda Cd. No:1',
  district: 'Kadıköy',
  neighborhood: 'Caferağa',
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 0 },
    { upToKm: 6, feeKurus: 2500 },
  ],
  deliveryRadiusKm: 6,
  freeDeliveryMinKurus: 30000,
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
  isVerified: false,
});

const MAIN = Object.assign(new Category(), { id: 'c1', slug: 'main-dish', isActive: true });
const SOUP = Object.assign(new Category(), { id: 'c2', slug: 'soup', isActive: true });
const photo = (id: string) => Object.assign(new FileType(), { id, path: `/${id}.png` });

const product = (overrides: Partial<Product> = {}) =>
  Object.assign(new Product(), {
    id: 'p1',
    kitchenId: 'k1',
    category: MAIN,
    name: 'Mantı',
    description: 'Yoğurtlu',
    priceKurus: 14000,
    saleType: SaleType.onDemand,
    prepMinutes: 45,
    portionsAvailable: null,
    allergens: [Allergen.milk, Allergen.gluten],
    dietTags: [],
    photos: [photo('f2'), photo('f1')],
    isActive: true,
    ...overrides,
  });

describe('kitchenCard', () => {
  it('should round coordinates and distance and price delivery by tier', () => {
    expect(kitchenCard(kitchen, 2.46, ctx)).toMatchObject({
      id: 'k1',
      latitude: 40.988,
      longitude: 29.022,
      distanceKm: 2.5,
      isOpenNow: true,
      opensAt: null,
      pickupAvailable: true,
      deliveryAvailable: true,
      deliveryFeeKurus: 2500,
      freeDeliveryMinKurus: 30000,
    });
  });

  it('should drop delivery beyond the last tier and pickup beyond the platform radius', () => {
    expect(kitchenCard(kitchen, 6.5, ctx)).toMatchObject({
      pickupAvailable: false,
      deliveryAvailable: false,
      deliveryFeeKurus: null,
    });
  });

  it('should not leak the exact address', () => {
    const card = kitchenCard(kitchen, 1, ctx);
    expect(card).not.toHaveProperty('fullAddress');
    expect(card).not.toHaveProperty('ownerId');
  });
});

describe('productCard', () => {
  it('should use the first photo and warn about the viewer’s allergens', () => {
    expect(productCard(product(), kitchen, 1, ctx)).toMatchObject({
      photo: { id: 'f2' },
      allergenWarnings: [Allergen.milk],
      kitchen: { id: 'k1', distanceKm: 1, isOpenNow: true },
    });
  });

  it('should have no photo without photos', () => {
    expect(productCard(product({ photos: [] }), kitchen, 1, ctx).photo).toBeNull();
  });
});

describe('kitchenDetail', () => {
  it('should group products by category in the given order', () => {
    const detail = kitchenDetail(
      kitchen,
      1,
      [product(), product({ id: 'p2', category: SOUP }), product({ id: 'p3' })],
      ctx,
    );

    expect(detail.sections.map((s) => s.category.id)).toEqual(['c1', 'c2']);
    expect(detail.sections[0].products.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(detail).toMatchObject({ description: 'Ev yemekleri', hours: kitchen.hours });
  });
});

describe('productDetail', () => {
  it('should carry every photo and the full kitchen card', () => {
    const detail = productDetail(product(), kitchen, 1, ctx);

    expect(detail.photos.map((p) => p.id)).toEqual(['f2', 'f1']);
    expect(detail.description).toBe('Yoğurtlu');
    expect(detail.kitchen).toMatchObject({ id: 'k1', deliveryFeeKurus: 0 });
  });
});
```

Run: `npx jest src/discovery/presenters.spec.ts` → FAIL.

- [ ] **Step 4: Kartlar — kod**

`src/discovery/presenters.ts`:

```ts
import { Allergen } from '../catalog/catalog.enums';
import { deliveryFeeFor } from '../catalog/delivery';
import { LatLng, roundCoord, roundDistance } from '../catalog/geo';
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
};

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

  return Object.assign(new KitchenDetail(), kitchenCard(kitchen, distanceKm, ctx), {
    description: kitchen.description,
    hours: kitchen.hours,
    deliveryTiers: kitchen.deliveryTiers,
    sections,
  });
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
```

Run: `npx jest src/discovery/presenters.spec.ts` → PASS (7 test).

- [ ] **Step 5: Sorgu DTO'su**

`src/discovery/dto/discover-query.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DietTag } from '../../catalog/catalog.enums';

/** The customer's selected address (or GPS) — distances are measured from here. */
export class PointQueryDto {
  @ApiProperty({ example: 40.9862 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 29.0254 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class DiscoverQueryDto extends PointQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: DietTag, description: 'vegetarian vegan ürünleri de kapsar' })
  @IsOptional()
  @IsEnum(DietTag)
  diet?: DietTag;

  @ApiPropertyOptional({
    default: false,
    description: 'Kullanıcının alerjen tercihleriyle çakışan ürünleri çıkar',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allergenSafe?: boolean;

  @ApiPropertyOptional({ description: 'Ürün adı/açıklaması, mutfak adı/semti' })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
```

- [ ] **Step 6: Repository (SQL)**

`src/discovery/discovery.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { Allergen, DietTag } from '../catalog/catalog.enums';
import { MAX_DELIVERY_RADIUS_KM } from '../catalog/delivery';
import { LatLng, boundingBox, haversineSql } from '../catalog/geo';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchenEntity } from '../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { KitchenMapper } from '../kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper';
import { Product } from '../products/domain/product';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { ProductMapper } from '../products/infrastructure/persistence/relational/mappers/product.mapper';

export type DiscoveryFilter = {
  point: LatLng;
  pickupRadiusKm: number;
  /** Istanbul weekday and "HH:mm" — orders open kitchens first. */
  clock: { dayOfWeek: number; time: string };
  categoryId?: string;
  diet?: DietTag;
  excludeAllergens: Allergen[];
  /** A likePattern(): folded and escaped. */
  query?: string;
  offset: number;
  limit: number;
};

export type KitchenHit = { kitchen: Kitchen; distanceKm: number };
export type ProductHit = { product: Product; kitchen: Kitchen; distanceKm: number };

const DISTANCE = haversineSql('k');

/** openingState().isOpenNow in SQL; "HH:mm" strings sort in time order. */
const OPEN_NOW =
  `(NOT k."isPaused" AND EXISTS (SELECT 1 FROM jsonb_array_elements(k."hours") AS slot ` +
  `WHERE (slot->>'dayOfWeek')::int = :dayOfWeek ` +
  `AND slot->>'opensAt' <= :time AND slot->>'closesAt' > :time))`;

/** isProductListed() in SQL, for product alias `p` and its category `c`. */
const listed = (p: string, c: string) =>
  `${p}."deletedAt" IS NULL AND ${p}."isActive" AND ${c}."isActive" ` +
  `AND (${p}."saleType" = 'on_demand' OR ${p}."portionsAvailable" > 0)`;

/**
 * Read side of discovery. Plain SQL over the kitchen/product tables (no
 * PostGIS): a bounding box narrows by index, haversine decides. Rules here
 * mirror visibility.ts.
 */
@Injectable()
export class DiscoveryRepository {
  constructor(
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {}

  async findKitchens(filter: DiscoveryFilter): Promise<KitchenHit[]> {
    const qb = this.kitchens
      .createQueryBuilder('k')
      .addSelect(DISTANCE, 'distance_km')
      .addSelect(OPEN_NOW, 'open_now');
    this.whereReachable(qb, filter);

    const productFilters = this.productFilters('p', filter);

    if (productFilters.length > 0 || filter.query) {
      const matches = filter.query
        ? [
            ...productFilters,
            '(p."searchText" LIKE :query OR k."searchText" LIKE :query)',
          ]
        : productFilters;
      const hasMatchingProduct =
        `EXISTS (SELECT 1 FROM "product" p INNER JOIN "category" c ON c."id" = p."categoryId" ` +
        `WHERE p."kitchenId" = k."id" AND ${listed('p', 'c')} AND ${matches.join(' AND ')})`;

      // A name match alone lists the kitchen only while no product filter is set.
      qb.andWhere(
        productFilters.length > 0
          ? hasMatchingProduct
          : `(k."searchText" LIKE :query OR ${hasMatchingProduct})`,
      );
    }

    const { entities, raw } = await this.page(qb, filter, 'k').getRawAndEntities();
    const distanceById = this.distances(raw as { k_id: string; distance_km: number }[], 'k_id');

    return entities.map((entity) => ({
      kitchen: KitchenMapper.toDomain(entity),
      distanceKm: distanceById.get(entity.id) ?? 0,
    }));
  }

  async findProducts(filter: DiscoveryFilter): Promise<ProductHit[]> {
    const qb = this.products
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.category', 'c')
      .innerJoinAndSelect('p.kitchen', 'k')
      .addSelect(DISTANCE, 'distance_km')
      .addSelect(OPEN_NOW, 'open_now')
      .where(listed('p', 'c'));
    this.whereReachable(qb, filter);

    for (const condition of this.productFilters('p', filter)) {
      qb.andWhere(condition);
    }

    if (filter.query) {
      qb.andWhere('p."searchText" LIKE :query');
    }

    const { entities, raw } = await this.page(qb, filter, 'p').getRawAndEntities();
    const distanceById = this.distances(raw as { p_id: string; distance_km: number }[], 'p_id');

    return entities.map((entity) => ({
      product: ProductMapper.toDomain(entity),
      kitchen: KitchenMapper.toDomain(entity.kitchen as KitchenEntity),
      distanceKm: distanceById.get(entity.id) ?? 0,
    }));
  }

  async findKitchenById(id: Kitchen['id']): Promise<Kitchen | null> {
    const entity = await this.kitchens.findOne({ where: { id } });
    return entity ? KitchenMapper.toDomain(entity) : null;
  }

  /** null when missing, deleted, or its kitchen is deleted. */
  async findProductById(
    id: Product['id'],
  ): Promise<{ product: Product; kitchen: Kitchen } | null> {
    const entity = await this.products.findOne({
      where: { id },
      relations: { kitchen: true },
    });

    if (!entity?.kitchen) {
      return null;
    }

    return {
      product: ProductMapper.toDomain(entity),
      kitchen: KitchenMapper.toDomain(entity.kitchen),
    };
  }

  /** Listed products of one kitchen, by category order, then oldest first. */
  async findListedProductsOfKitchen(kitchenId: Kitchen['id']): Promise<Product[]> {
    const entities = await this.products
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.category', 'c')
      .where('p."kitchenId" = :kitchenId', { kitchenId })
      .andWhere(listed('p', 'c'))
      .orderBy('c.sortOrder', 'ASC')
      .addOrderBy('p.createdAt', 'ASC')
      .getMany();

    return entities.map((entity) => ProductMapper.toDomain(entity));
  }

  /** Mirrors isKitchenReachable(); expects kitchen alias `k`. */
  private whereReachable<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    filter: DiscoveryFilter,
  ): void {
    const box = boundingBox(
      filter.point,
      Math.max(MAX_DELIVERY_RADIUS_KM, filter.pickupRadiusKm),
    );

    qb.andWhere('k."deletedAt" IS NULL')
      .andWhere(
        'k."latitude" BETWEEN :minLat AND :maxLat AND k."longitude" BETWEEN :minLng AND :maxLng',
        box,
      )
      .andWhere(
        `((k."deliveryEnabled" AND ${DISTANCE} <= k."deliveryRadiusKm") ` +
          `OR (k."pickupEnabled" AND ${DISTANCE} <= :pickupRadiusKm))`,
      );
  }

  private productFilters(p: string, filter: DiscoveryFilter): string[] {
    const conditions: string[] = [];

    if (filter.categoryId) {
      conditions.push(`${p}."categoryId" = :categoryId`);
    }

    if (filter.diet === DietTag.vegan) {
      conditions.push(`'vegan' = ANY(string_to_array(${p}."dietTags", ','))`);
    }

    if (filter.diet === DietTag.vegetarian) {
      conditions.push(
        `string_to_array(${p}."dietTags", ',') && ARRAY['vegetarian', 'vegan']`,
      );
    }

    if (filter.excludeAllergens.length > 0) {
      conditions.push(
        `NOT (string_to_array(${p}."allergens", ',') && CAST(:excludeAllergens AS text[]))`,
      );
    }

    return conditions;
  }

  /** Shared parameters, ordering (open first, nearest first) and paging. */
  private page<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    filter: DiscoveryFilter,
    alias: string,
  ): SelectQueryBuilder<T> {
    const parameters: Record<string, unknown> = {
      lat: filter.point.latitude,
      lng: filter.point.longitude,
      pickupRadiusKm: filter.pickupRadiusKm,
      dayOfWeek: filter.clock.dayOfWeek,
      time: filter.clock.time,
      categoryId: filter.categoryId,
      excludeAllergens: filter.excludeAllergens,
      query: filter.query,
    };

    return qb
      .setParameters(
        Object.fromEntries(
          Object.entries(parameters).filter(([, value]) => value !== undefined),
        ),
      )
      .orderBy('open_now', 'DESC')
      .addOrderBy('distance_km', 'ASC')
      .addOrderBy(`${alias}.id`, 'ASC')
      .offset(filter.offset)
      .limit(filter.limit);
  }

  private distances<K extends string>(
    rows: (Record<K, string> & { distance_km: number })[],
    idColumn: K,
  ): Map<string, number> {
    return new Map(rows.map((row) => [row[idColumn], Number(row.distance_km)]));
  }
}
```

(Notlar: `offset/limit` kullanılır, `skip/take` değil — join'ler çoğaltmadığı için doğru ve TypeORM'un hesaplanmış sütunla sıralamada `skip/take` sorunu yaşanmaz. Mapper `entity.kitchen`'ı ve `entity.category`'yi join'den alır.)

- [ ] **Step 7: Servis, controller, modül**

`src/discovery/discovery.service.ts`:

```ts
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { likePattern } from '../catalog/fold-turkish';
import { haversineKm } from '../catalog/geo';
import { istanbulClock } from '../catalog/opening-state';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { User } from '../users/domain/user';
import { UsersService } from '../users/users.service';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { DiscoveryFilter, DiscoveryRepository } from './discovery.repository';
import { DiscoverQueryDto, PointQueryDto } from './dto/discover-query.dto';
import {
  ViewerContext,
  kitchenCard,
  kitchenDetail,
  productCard,
  productDetail,
} from './presenters';
import {
  KitchenCard,
  KitchenDetail,
  ProductCard,
  ProductDetail,
} from './views';
import { isKitchenReachable, isProductListed } from './visibility';

const notFound = () =>
  new NotFoundException({ status: HttpStatus.NOT_FOUND, error: 'notFound' });

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async kitchens(
    userId: User['id'],
    query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    const ctx = await this.context(userId, query);
    const hits = await this.discoveryRepository.findKitchens(
      this.filter(ctx, query),
    );

    return infinityPagination(
      hits.map((hit) => kitchenCard(hit.kitchen, hit.distanceKm, ctx)),
      { page: query.page, limit: query.limit },
    );
  }

  async products(
    userId: User['id'],
    query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<ProductCard>> {
    const ctx = await this.context(userId, query);
    const hits = await this.discoveryRepository.findProducts(
      this.filter(ctx, query),
    );

    return infinityPagination(
      hits.map((hit) =>
        productCard(hit.product, hit.kitchen, hit.distanceKm, ctx),
      ),
      { page: query.page, limit: query.limit },
    );
  }

  /** Out of reach is a 404 — except for the kitchen's own cook. */
  async kitchen(
    userId: User['id'],
    id: Kitchen['id'],
    point: PointQueryDto,
  ): Promise<KitchenDetail> {
    const ctx = await this.context(userId, point);
    const kitchen = await orNotFound(
      this.discoveryRepository.findKitchenById(id),
    );
    const distanceKm = haversineKm(ctx.point, kitchen);

    if (
      !this.isOwner(kitchen, ctx) &&
      !isKitchenReachable(kitchen, distanceKm, ctx.pickupRadiusKm)
    ) {
      throw notFound();
    }

    const products =
      await this.discoveryRepository.findListedProductsOfKitchen(kitchen.id);

    return kitchenDetail(kitchen, distanceKm, products, ctx);
  }

  async product(
    userId: User['id'],
    id: string,
    point: PointQueryDto,
  ): Promise<ProductDetail> {
    const ctx = await this.context(userId, point);
    const { product, kitchen } = await orNotFound(
      this.discoveryRepository.findProductById(id),
    );
    const distanceKm = haversineKm(ctx.point, kitchen);
    const visible =
      isKitchenReachable(kitchen, distanceKm, ctx.pickupRadiusKm) &&
      isProductListed(product);

    if (!this.isOwner(kitchen, ctx) && !visible) {
      throw notFound();
    }

    return productDetail(product, kitchen, distanceKm, ctx);
  }

  private isOwner(kitchen: Kitchen, ctx: ViewerContext): boolean {
    return String(kitchen.ownerId) === String(ctx.userId);
  }

  private async context(
    userId: User['id'],
    point: PointQueryDto,
  ): Promise<ViewerContext> {
    const user = await this.usersService.findById(userId);

    return {
      userId,
      allergenPreferences: user?.allergenPreferences ?? [],
      point: { latitude: point.lat, longitude: point.lng },
      pickupRadiusKm: this.configService.getOrThrow(
        'discovery.pickupRadiusKm',
        { infer: true },
      ),
      coordPrecision: this.configService.getOrThrow(
        'discovery.coordPrecision',
        { infer: true },
      ),
      now: new Date(),
    };
  }

  private filter(ctx: ViewerContext, query: DiscoverQueryDto): DiscoveryFilter {
    return {
      point: ctx.point,
      pickupRadiusKm: ctx.pickupRadiusKm,
      clock: istanbulClock(ctx.now),
      categoryId: query.categoryId,
      diet: query.diet,
      excludeAllergens: query.allergenSafe ? ctx.allergenPreferences : [],
      query: query.q ? likePattern(query.q) : undefined,
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    };
  }
}
```

`src/discovery/discovery.controller.ts`:

```ts
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { DiscoveryService } from './discovery.service';
import { DiscoverQueryDto, PointQueryDto } from './dto/discover-query.dto';
import {
  KitchenCard,
  KitchenDetail,
  ProductCard,
  ProductDetail,
} from './views';

@ApiTags('Discovery')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'discover',
  version: '1',
})
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('kitchens')
  @ApiOkResponse({ type: InfinityPaginationResponse(KitchenCard) })
  kitchens(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    return this.discoveryService.kitchens(request.user.id, query);
  }

  @Get('products')
  @ApiOkResponse({ type: InfinityPaginationResponse(ProductCard) })
  products(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<ProductCard>> {
    return this.discoveryService.products(request.user.id, query);
  }

  @Get('kitchens/:id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenDetail })
  kitchen(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() point: PointQueryDto,
  ): Promise<KitchenDetail> {
    return this.discoveryService.kitchen(request.user.id, id, point);
  }

  @Get('products/:id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: ProductDetail })
  product(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() point: PointQueryDto,
  ): Promise<ProductDetail> {
    return this.discoveryService.product(request.user.id, id, point);
  }
}
```

`src/discovery/discovery.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KitchenEntity } from '../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { UsersModule } from '../users/users.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryRepository } from './discovery.repository';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [TypeOrmModule.forFeature([KitchenEntity, ProductEntity]), UsersModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DiscoveryRepository],
})
export class DiscoveryModule {}
```

`src/app.module.ts` — `imports` dizisine `DiscoveryModule` ekle (`import { DiscoveryModule } from './discovery/discovery.module';`).

Run: `npm run build && npx jest src/discovery`
Expected: derleme hatasız, testler PASS.

- [ ] **Step 8: Elle SQL kontrolü**

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/phone/login -H 'content-type: application/json' -d '{"idToken":"dev:+905559990002"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
curl -s "localhost:3001/api/v1/discover/products?lat=40.99&lng=29.02&q=manti&diet=vegetarian&allergenSafe=true" -H "authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0))'
```

Expected: `status: true`, `data: { data: [...], hasNextPage: false }` — SQL hatası (500) yok. 500 dönerse API terminalindeki logda SQL'i oku; en olası neden tırnaksız bir sütun adıdır.

- [ ] **Step 9: e2e — keşif blokları**

`test/user/catalog.e2e-spec.ts` — `// TASK-6-DISCOVERY` satırını şununla değiştir:

```ts
  const discover = (
    path: string,
    token: string,
    query: Record<string, unknown>,
  ) =>
    request(app)
      .get(`/api/v1/discover/${path}`)
      .auth(token, { type: 'bearer' })
      .query(query);

  const ids = (body: { data: { data: { id: string }[] } }) =>
    body.data.data.map((item) => item.id);

  type Card = { id: string } & Record<string, unknown>;
  const find = (body: { data: { data: Card[] } }, id: string) =>
    body.data.data.find((item) => item.id === id);

  it('should list nearby products with their kitchen', () =>
    discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toEqual(expect.arrayContaining([mantiId, kofteId]));
        expect(find(body, mantiId)).toMatchObject({
          priceKurus: 14000,
          photo: { id: expect.any(String) },
          allergenWarnings: [],
          kitchen: { id: kitchenId, distanceKm: 0 },
        });
        expect(find(body, mantiId)).not.toHaveProperty('searchText');
      }));

  it('should hide kitchens beyond both delivery and pickup range', () =>
    discover('products', customer, north(30))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(mantiId);
      }));

  it('should price delivery by tier and round the coordinates', () =>
    discover('kitchens', customer, north(3))
      .expect(200)
      .expect(({ body }) => {
        const kitchen = find(body, kitchenId);
        expect(kitchen).toMatchObject({
          deliveryAvailable: true,
          deliveryFeeKurus: 2500,
          pickupAvailable: true,
          latitude: Number(HOME.latitude.toFixed(3)),
        });
        expect(kitchen?.distanceKm).toBeCloseTo(3, 0);
        expect(kitchen).not.toHaveProperty('fullAddress');
      }));

  it('should search with folded Turkish text', async () => {
    await discover('products', customer, { ...north(0), q: 'manti' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(mantiId);
        expect(ids(body)).not.toContain(kofteId);
      });

    await discover('products', customer, { ...north(0), q: 'KÖFTE' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kofteId);
      });

    await discover('kitchens', customer, { ...north(0), q: 'köfte' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kitchenId);
      });
  });

  it('should filter by diet and category', async () => {
    await discover('products', customer, { ...north(0), diet: 'vegetarian' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kofteId);
        expect(ids(body)).not.toContain(mantiId);
      });

    await discover('kitchens', customer, { ...north(0), categoryId: soupId })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(kitchenId);
      });
  });

  it('should honour allergen preferences', async () => {
    await request(app)
      .patch('/api/v1/auth/me')
      .auth(customer, { type: 'bearer' })
      .send({ allergenPreferences: ['milk'] })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.allergenPreferences).toEqual(['milk']);
      });

    await discover('products', customer, { ...north(0), allergenSafe: true })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(mantiId);
        expect(ids(body)).toContain(kofteId);
      });

    await discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(find(body, mantiId)?.allergenWarnings).toEqual(['milk']);
      });
  });

  it('should reject an unknown allergen preference', () =>
    request(app)
      .patch('/api/v1/auth/me')
      .auth(customer, { type: 'bearer' })
      .send({ allergenPreferences: ['peanut'] })
      .expect(422));

  it('should show the kitchen menu grouped by category', () =>
    discover(`kitchens/${kitchenId}`, customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: kitchenId,
          description: 'Ev yemekleri',
          hours: ALL_WEEK,
        });
        expect(body.data.sections).toHaveLength(1);
        expect(body.data.sections[0].category.id).toBe(categoryId);
        expect(
          body.data.sections[0].products.map((p: { id: string }) => p.id),
        ).toEqual([mantiId, kofteId]);
      }));

  it('should show product detail with every photo', () =>
    discover(`products/${mantiId}`, customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.photos).toHaveLength(2);
        expect(body.data).toMatchObject({
          description: 'Yoğurtlu',
          kitchen: { id: kitchenId, deliveryFeeKurus: 0 },
        });
      }));

  it('should drop sold-out daily portions', async () => {
    await request(app)
      .patch(`/api/v1/kitchens/me/products/${kofteId}`)
      .auth(cook, { type: 'bearer' })
      .send({ portionsAvailable: 0 })
      .expect(200);

    await discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(kofteId);
      });

    await discover(`products/${kofteId}`, customer, north(0)).expect(404);
  });

  it('should keep a paused kitchen listed but closed', async () => {
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(200);

    await discover('kitchens', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(find(body, kitchenId)).toMatchObject({
          isPaused: true,
          isOpenNow: false,
          opensAt: null,
        });
      });

    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: false })
      .expect(200);
  });

  it('should open a far-away kitchen only for its owner', async () => {
    await discover(`kitchens/${kitchenId}`, customer, north(30)).expect(404);
    await discover(`kitchens/${kitchenId}`, cook, north(30)).expect(200);
  });

  it('should take the menu down when the cook deletes the account', async () => {
    await request(app)
      .delete('/api/v1/auth/me')
      .auth(cook, { type: 'bearer' })
      .expect(204);

    await discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(mantiId);
      });

    await discover(`kitchens/${kitchenId}`, customer, north(0)).expect(404);
  });
```

Run: `npm run test:e2e -- --runInBand test/user/catalog.e2e-spec.ts`
Expected: PASS (31 test).

- [ ] **Step 10: Tüm paket ve commit**

Run: `npm test && npm run lint && npm run test:e2e -- --runInBand`
Expected: PASS.

```bash
git add src/discovery src/app.module.ts test/user/catalog.e2e-spec.ts
git commit -m "feat(discovery): nearby kitchens and dishes, search and detail

- haversine with a bounding-box pre-filter, no PostGIS
- open kitchens first, then nearest; paused ones stay listed
- category, diet and allergen filters; Turkish-folded search
- approximate coordinates; details 404 out of reach except for the owner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Geliştirme seed'i, belgeler, son doğrulama

**Files:**
- Create: `src/database/seeds/relational/kitchen/kitchen-seed.module.ts`, `src/database/seeds/relational/kitchen/kitchen-seed.service.ts`
- Modify: `src/database/seeds/relational/seed.module.ts`, `src/database/seeds/relational/run-seed.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `UserEntity`, `KitchenEntity`, `ProductEntity`, `CategoryEntity`, `foldTurkish`, `deliveryRadiusOf`, `RoleEnum`, `StatusEnum`, `AuthProvidersEnum`, `Allergen`, `DietTag`, `SaleType`.
- Produces: dev ortamında Kadıköy civarında 3 mutfak / 12 ürün; telefon `+905550000101..103` ile girilebilir.

- [ ] **Step 1: Kitchen seed**

`src/database/seeds/relational/kitchen/kitchen-seed.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthProvidersEnum } from '../../../../auth/auth-providers.enum';
import { Allergen, DietTag, SaleType } from '../../../../catalog/catalog.enums';
import { foldTurkish } from '../../../../catalog/fold-turkish';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { deliveryRadiusOf } from '../../../../kitchens/kitchen-rules';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';

type SeedProduct = {
  category: string;
  name: string;
  description: string;
  priceKurus: number;
  saleType: SaleType;
  prepMinutes?: number;
  portionsAvailable?: number;
  allergens: Allergen[];
  dietTags: DietTag[];
};

type SeedKitchen = {
  phoneNumber: string;
  firstName: string;
  lastName: string;
  name: string;
  description: string;
  district: string;
  neighborhood: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  products: SeedProduct[];
};

const WEEKDAYS_11_TO_20 = [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '11:00',
  closesAt: '20:00',
}));

const TIERS = [
  { upToKm: 1, feeKurus: 0 },
  { upToKm: 3, feeKurus: 2000 },
  { upToKm: 5, feeKurus: 3500 },
];

const KITCHENS: SeedKitchen[] = [
  {
    phoneNumber: '+905550000101',
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    name: 'Ayşe Teyze’nin Mutfağı',
    description: 'Moda’da annemin tarifleriyle ev yemekleri.',
    district: 'Kadıköy',
    neighborhood: 'Caferağa',
    fullAddress: 'Caferağa Mh. Moda Cd. No:10',
    latitude: 40.9862,
    longitude: 29.0254,
    pickupEnabled: true,
    deliveryEnabled: true,
    products: [
      { category: 'pastry', name: 'Ev usulü mantı', description: 'Yoğurt ve tereyağlı sos ile.', priceKurus: 14000, saleType: SaleType.onDemand, prepMinutes: 45, allergens: [Allergen.gluten, Allergen.milk, Allergen.eggs], dietTags: [] },
      { category: 'soup', name: 'Mercimek çorbası', description: 'Limon ve kıtır ekmekle.', priceKurus: 6000, saleType: SaleType.dailyPortion, portionsAvailable: 12, allergens: [Allergen.celery], dietTags: [DietTag.vegan] },
      { category: 'main-dish', name: 'Karnıyarık', description: 'Pilav ile servis edilir.', priceKurus: 16000, saleType: SaleType.dailyPortion, portionsAvailable: 6, allergens: [], dietTags: [] },
      { category: 'dessert', name: 'Fırın sütlaç', description: 'Bol tarçınlı.', priceKurus: 6500, saleType: SaleType.dailyPortion, portionsAvailable: 8, allergens: [Allergen.milk], dietTags: [DietTag.vegetarian] },
    ],
  },
  {
    phoneNumber: '+905550000102',
    firstName: 'Nuran',
    lastName: 'Kaya',
    name: 'Nuran Hanım Zeytinyağlıları',
    description: 'Ege usulü zeytinyağlılar.',
    district: 'Kadıköy',
    neighborhood: 'Fenerbahçe',
    fullAddress: 'Fenerbahçe Mh. Fener Kalamış Cd. No:22',
    latitude: 40.9741,
    longitude: 29.0387,
    pickupEnabled: true,
    deliveryEnabled: false,
    products: [
      { category: 'olive-oil', name: 'Zeytinyağlı enginar', description: 'Bezelye ve havuçlu.', priceKurus: 12000, saleType: SaleType.dailyPortion, portionsAvailable: 5, allergens: [], dietTags: [DietTag.vegan] },
      { category: 'olive-oil', name: 'Yaprak sarma', description: 'Limonlu, zeytinyağlı.', priceKurus: 11000, saleType: SaleType.dailyPortion, portionsAvailable: 10, allergens: [], dietTags: [DietTag.vegan] },
      { category: 'salad', name: 'Gavurdağı salatası', description: 'Cevizli, nar ekşili.', priceKurus: 8000, saleType: SaleType.onDemand, prepMinutes: 15, allergens: [Allergen.treeNuts], dietTags: [DietTag.vegan] },
      { category: 'breakfast', name: 'Menemen', description: 'Köy yumurtası ile.', priceKurus: 9000, saleType: SaleType.onDemand, prepMinutes: 20, allergens: [Allergen.eggs], dietTags: [DietTag.vegetarian] },
    ],
  },
  {
    phoneNumber: '+905550000103',
    firstName: 'Hatice',
    lastName: 'Demir',
    name: 'Hatice Teyze Börek Evi',
    description: 'Her sabah taze börek.',
    district: 'Kadıköy',
    neighborhood: 'Koşuyolu',
    fullAddress: 'Koşuyolu Mh. Mahmut Yesari Cd. No:5',
    latitude: 41.0012,
    longitude: 29.0389,
    pickupEnabled: false,
    deliveryEnabled: true,
    products: [
      { category: 'pastry', name: 'Su böreği', description: 'Peynirli, tepsi dilimi.', priceKurus: 9500, saleType: SaleType.dailyPortion, portionsAvailable: 15, allergens: [Allergen.gluten, Allergen.milk, Allergen.eggs], dietTags: [DietTag.vegetarian] },
      { category: 'pastry', name: 'Ispanaklı gözleme', description: 'Sac üstünde.', priceKurus: 8000, saleType: SaleType.onDemand, prepMinutes: 25, allergens: [Allergen.gluten], dietTags: [DietTag.vegan] },
      { category: 'main-dish', name: 'İçli köfte', description: 'Haşlama, 3 adet.', priceKurus: 13000, saleType: SaleType.dailyPortion, portionsAvailable: 0, allergens: [Allergen.gluten, Allergen.treeNuts], dietTags: [] },
      { category: 'drink', name: 'Ev yapımı ayran', description: 'Köpüklü.', priceKurus: 2500, saleType: SaleType.onDemand, prepMinutes: 5, allergens: [Allergen.milk], dietTags: [DietTag.vegetarian] },
    ],
  },
];

/** Development data only: three cooks near Moda with a menu each (no photos). */
@Injectable()
export class KitchenSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
  ) {}

  async run() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const categoryIds = new Map(
      (await this.categories.find()).map((c) => [c.slug, c.id]),
    );

    for (const seed of KITCHENS) {
      if (await this.users.exists({ where: { phoneNumber: seed.phoneNumber } })) {
        continue;
      }

      const owner = await this.users.save(
        this.users.create({
          phoneNumber: seed.phoneNumber,
          firstName: seed.firstName,
          lastName: seed.lastName,
          email: null,
          provider: AuthProvidersEnum.phone,
          kvkkAcceptedAt: new Date(),
          role: { id: RoleEnum.user },
          status: { id: StatusEnum.active },
        }),
      );

      const kitchen = await this.kitchens.save(
        this.kitchens.create({
          ownerId: owner.id,
          name: seed.name,
          description: seed.description,
          coverPhoto: null,
          fullAddress: seed.fullAddress,
          district: seed.district,
          neighborhood: seed.neighborhood,
          latitude: seed.latitude,
          longitude: seed.longitude,
          pickupEnabled: seed.pickupEnabled,
          deliveryEnabled: seed.deliveryEnabled,
          deliveryTiers: TIERS,
          deliveryRadiusKm: deliveryRadiusOf({
            deliveryEnabled: seed.deliveryEnabled,
            deliveryTiers: TIERS,
          }),
          freeDeliveryMinKurus: 30000,
          hours: WEEKDAYS_11_TO_20,
          isPaused: false,
          isVerified: false,
          searchText: foldTurkish(
            `${seed.name} ${seed.description} ${seed.district} ${seed.neighborhood}`,
          ),
        }),
      );

      await this.products.save(
        seed.products.map((product) =>
          this.products.create({
            kitchenId: kitchen.id,
            categoryId: categoryIds.get(product.category),
            name: product.name,
            description: product.description,
            priceKurus: product.priceKurus,
            saleType: product.saleType,
            prepMinutes: product.prepMinutes ?? null,
            portionsAvailable: product.portionsAvailable ?? null,
            allergens: product.allergens,
            dietTags: product.dietTags,
            photos: [],
            isActive: true,
            searchText: foldTurkish(`${product.name} ${product.description}`),
          }),
        ),
      );
    }
  }
}
```

`src/database/seeds/relational/kitchen/kitchen-seed.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryEntity } from '../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { KitchenSeedService } from './kitchen-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      KitchenEntity,
      ProductEntity,
      CategoryEntity,
    ]),
  ],
  providers: [KitchenSeedService],
  exports: [KitchenSeedService],
})
export class KitchenSeedModule {}
```

`seed.module.ts` — `imports`'a `KitchenSeedModule`. `run-seed.ts` — `CategorySeedService`'ten sonra `await app.get(KitchenSeedService).run();` (import ile).

(`AuthProvidersEnum.phone` Faz 1'de eklendi. `UserEntity` alan adları — `provider`, `kvkkAcceptedAt`, `role`, `status` — `user-seed.service.ts` ile aynı; derleme hatası verirse oradaki kullanıma uy.)

Run: `npm run seed:run:relational`
Expected: hatasız; ikinci çalıştırmada değişiklik yok.

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/phone/login -H 'content-type: application/json' -d '{"idToken":"dev:+905559990003"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
curl -s "localhost:3001/api/v1/discover/kitchens?lat=40.9862&lng=29.0254" -H "authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.data.map(k => [k.name, k.distanceKm, k.deliveryFeeKurus, k.pickupAvailable])'
```

Expected: üç mutfak; Ayşe Teyze 0 km / ücret 0; Nuran Hanım (yalnız gel-al) `deliveryFeeKurus: null`, `pickupAvailable: true`; Hatice Teyze (yalnız teslimat) ~1.9 km / 2000.

- [ ] **Step 2: CLAUDE.md**

`CLAUDE.md` — "API conventions" listesinin sonuna:

```markdown
- Catalog (Faz 2): one kitchen per user (`/kitchens/me`), its menu under `/kitchens/me/products`; customers read through `/discover/*` only. Kitchen address is a copy of an address-book entry; customers get coordinates rounded to `DISCOVERY_COORD_PRECISION`, never `fullAddress`. Delivery tiers and weekly hours are jsonb on `kitchen`; `deliveryRadiusKm` and every `searchText` are derived on write — never set them by hand.
- Money is integer kuruş (`priceKurus`, `feeKurus`). Time is `Europe/Istanbul` (`catalog/opening-state.ts`).
- Search text goes through `catalog/fold-turkish.ts` both when stored and when queried; Postgres `lower()` gets İ/I wrong.
- Discovery visibility lives twice and must stay in step: SQL in `discovery/discovery.repository.ts`, TypeScript in `discovery/visibility.ts`.
- Dev seed (`npm run seed:run:relational`) adds categories everywhere and, outside production, three Kadıköy kitchens whose cooks log in with `dev:+905550000101..103`.
```

- [ ] **Step 3: Son doğrulama**

Run: `npm run lint && npm test && npm run test:e2e -- --runInBand && npm run build`
Expected: hepsi PASS. Swagger'da (`http://localhost:3001/docs`) Categories, Kitchens, Products, Discovery etiketleri görünür.

- [ ] **Step 4: Commit**

```bash
git add src/database/seeds CLAUDE.md
git commit -m "chore(seed): three dev kitchens near Moda; document catalog conventions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
