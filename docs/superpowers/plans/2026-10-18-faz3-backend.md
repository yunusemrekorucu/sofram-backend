# Faz 3 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sofram API'sine sipariş akışını eklemek: teklif (`POST /orders/quote`), tek transaction'da sipariş + porsiyon düşümü + ödeme, müşteri takibi ve iptali, aşçının sipariş sekmeleri ve durum geçişleri, kabul süresi dolması, hesap silme kuralları ve geliştirme seed'i.

**Architecture:** NestJS + TypeORM (brocoders boilerplate, hexagonal: `domain/` ↔ `infrastructure/persistence/relational/`). `order`, `order_item`, `order_request`, `payment` tabloları hygen generator'larıyla üretilir, sonra dosyalar bu plandaki son hallerine getirilir. Saf iş kuralları (`orders/order-status.ts` geçiş tablosu, `orders/order-pricing.ts` `quoteOrder`, kod üreticileri, İstanbul gün/hafta başı, presenter'lar) birim testli; durum değişikliklerinin tek kapısı `OrderLifecycleService` (koşullu `UPDATE … WHERE status IN`, kapanışta porsiyon iadesi + ödeme iadesi). Ödeme `PaymentProvider` arayüzü arkasında, yalnız `DevPaymentProvider`. SQL tarafı (`OrderRelationalRepository`) e2e ile test edilir.

**Tech Stack:** NestJS 11, TypeORM 0.3.28, PostgreSQL 16 (Homebrew, Docker yok), class-validator 0.15 / class-transformer 0.5, `@nestjs/schedule` 6.1.3 (yeni), Jest 30 + supertest.

**Spec:** `docs/superpowers/specs/2026-10-18-faz3-siparis-design.md` (bağlayıcı). Faz 1 ve Faz 2 spec'lerinin **§8 "Uygulama notları"** tabloları geçerli (ör. `/discover/...` detay yolları, mutfak `deliveryTiers`/`hours` jsonb, müşteriye dönen mesafe **yuvarlanmış** mutfak noktasından). Bu planın kendi kararları en sondaki **Uygulama notları** tablosunda.

## Global Constraints

- Yanıt zarfı ve hata formatı Faz 1'deki gibi: `{ data, status, statusCode, message }`; hata `errors: { field, message }[]`, nokta yollu (`items.1.productId`). 204 sarılmaz. İş kuralı hataları `new UnprocessableEntityException({ status: 422, errors: { field: 'key' } })`; diğerleri `{ status, error: 'key' }` (filtre `error`'ı `message` yapar).
- Başkasının kaydı → **404** (`orNotFound(...)`), 403 değil. Tüm endpoint'ler JWT ister.
- Endpoint'ler (`/api/v1`): müşteri `POST /orders/quote`, `POST /orders` (başlık `Idempotency-Key`, uuid, zorunlu), `GET /orders?scope=active|past&page&limit`, `GET /orders/:id`, `POST /orders/:id/cancel`; aşçı `GET /kitchens/me/orders?tab=new|preparing|ready|done&page&limit`, `GET /kitchens/me/orders/summary`, `GET /kitchens/me/orders/:id`, `POST /kitchens/me/orders/:id/accept|reject|start|ready|dispatch|complete|cancel`; `PATCH /kitchens/me` ve `GET /discover/kitchens/:id` artık `minOrderKurus` taşır.
- Durumlar (`OrderStatus`): `pending`, `accepted`, `preparing`, `ready`, `on_the_way`, `completed`, `rejected`, `cancelled`, `expired`. **Aktif:** `pending`, `accepted`, `preparing`, `ready`, `on_the_way`. **Kapalı:** `completed`, `rejected`, `cancelled`, `expired`.
- Teslim tipi `pickup` | `delivery`; `cancelledBy` `customer` | `cook` | `system`; sebep (`OrderReason`) `out_of_ingredients`, `too_busy`, `time_not_suitable`, `other` — `reject` ve aşçı `cancel` için zorunlu, müşteri iptali ve süre dolmasında null.
- Hata anahtarları: **409 `orderStatusConflict`** (geçersiz geçiş / yarış), **409 `orderTotalChanged`** + `data.quote`, **402 `paymentFailed`**, **409 `activeOrdersExist`**, **422 `pickupCode`** (alan). Teklif engelleri (`issues`/`blockers`) teklifte 200 içinde; `POST /orders`'da 422 (`field`: `items.N.productId`, `kitchenId`, `addressId`, `fulfillment`; `message`: issue/blocker adı).
- Issue türleri `unavailable`, `insufficient_portions` (+ `available`); blocker'lar `kitchen_closed`, `fulfillment_unavailable`, `out_of_range`, `below_minimum`, `own_kitchen`. `canOrder = issues.length === 0 && blockers.length === 0`.
- Sınırlar: kalem 1–20, `quantity` 1–20, sipariş `note` ≤ 300, kalem `note` ≤ 140, `minOrderKurus` 0–100000 (nullable), `pickupCode` 4 rakam, `expectedTotalKurus` int ≥ 0, `acceptedTerms` `true` olmalı.
- Kod biçimi: `S-` + 4 karakter, alfabe `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (0/O, 1/I/L yok), `varchar(6)` unique, çakışmada yeniden üretilir. `pickupCode` 4 rakam, yalnız `pickup`, yalnız müşteriye döner.
- Tutarlar her yerde **kuruş, tamsayı**. `serviceFeeKurus = Math.round(subtotal × ORDER_SERVICE_FEE_PERCENT / 100)`; ücretsiz teslimat `subtotal ≥ freeDeliveryMinKurus`; minimum `subtotal < minOrderKurus` → `below_minimum`.
- `estimatedReadyAt = acceptedAt + max(on_demand prepMinutes, daily_portion → 0) + (delivery ise ORDER_DELIVERY_BUFFER_MINUTES)`; kabulden önce aynı formül `estimatedMinutes` olarak.
- Konfigürasyon (`.env`, `env-example-relational`): `ORDER_ACCEPT_MINUTES=3`, `ORDER_DELIVERY_BUFFER_MINUTES=15`, `ORDER_SERVICE_FEE_PERCENT=5`, `PAYMENT_PROVIDER=dev`, `DEV_PAYMENT_FAIL=false` (production'da yok sayılır).
- Saat dilimi `Europe/Istanbul` (UTC+3, yaz saati yok); "bugün" ve "bu hafta (pazartesiden)" İstanbul'a göre. Yeni tablolarda zaman sütunları `timestamptz`.
- Entity ve alanlar **önce generator ile** eklenir (`npm run generate:resource:relational -- --name X`, `npm run add:property:to-relational -- ...`); ardından dosyalar bu plandaki son hallerine getirilir. `id`/`createdAt`/`updatedAt` generator'a verilmez; `User`/`File` generate edilmez. Generator'ların `postscript`'i `lint --fix` çalıştırır; ara adımlarda lint hatası verebilir, dosyalar son haline gelince temizlenir.
- Migration'lar elle yazılmaz: `npm run migration:generate -- src/database/migrations/<Ad>` + `npm run migration:run`.
- Ham SQL'de sütunlar tırnaklı (`o."kitchenId"`), `order` tablosu her zaman `"order"` (SQL anahtar kelimesi).
- Testlerde `it(...)` adları `should` ile başlar (ESLint kuralı); `configService.get/getOrThrow` her zaman `{ infer: true }` ile.
- Commit: `main` üzerinde (dal açılmaz), conventional commits, konu küçük harfle (commitlint `subject-case`). Husky pre-commit `lint` + `test` çalıştırır. Her commit mesajı şu satırla biter:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Yerel ortam: API `http://localhost:3001` (`npm run start:dev`, watch mode — `CI=1` ile başlatma, izleme kapanır), Postgres `localhost:5432` db/rol `sofram`, `.env`'de `AUTH_PHONE_DEV_VERIFIER=true`. `npm run build` `dist/`'i silip çalışan dev API'yi düşürür; tip kontrolü için `npx tsc --noEmit -p tsconfig.json`. `.env` commit edilmez.

## File Structure

```
src/orders/                            sipariş modülü (müşteri + aşçı + zamanlanmış iş)
  order.enums.ts                       OrderStatus, Fulfillment, CancelledBy, OrderReason, CookTab, OrderScope
  order-status.ts (+ spec)             ACTIVE/CLOSED/ROLLBACK_STATUSES, OrderAction, transitionFor, canTransition, STAMP_FOR, COOK_TAB_STATUSES
  order-pricing.ts (+ spec)            quoteOrder, estimatedMinutesFor, estimatedReadyAt, quoteFieldErrors (saf)
  order-codes.ts (+ spec)              generateOrderCode, generatePickupCode
  order-time.ts (+ spec)               istanbulDayStart, istanbulWeekStart
  config/                              orders.config.ts (+ spec), orders-config.type.ts
  domain/order.ts, domain/order-item.ts Order, OrderItem, DeliveryAddress, NewOrder, OrderPatch …
  infrastructure/persistence/
    order.repository.ts                port + PortionTake, InsufficientPortionsError, DuplicateOrderRequestError
    relational/entities/               order.entity.ts, order-item.entity.ts, order-request.entity.ts (generator)
    relational/mappers/                order.mapper.ts (+ spec), order-item.mapper.ts
    relational/repositories/           order.repository.ts (transaction'lı yerleştirme, koşullu geçiş, listeler, özet)
  order-errors.ts                      orderStatusConflict, orderTotalChanged, activeOrdersExist
  order-lifecycle.service.ts (+ spec)  advance, expireOverdue — tek durum değiştirme kapısı
  orders.service.ts (+ spec)           müşteri: quote, create, list, detail, cancel; hesap silme yardımcıları
  cook-orders.service.ts (+ spec)      aşçı: list, summary, detail, accept … cancel
  orders-expiry.task.ts (+ spec)       30 sn'lik tarama
  orders.controller.ts                 /orders
  cook-orders.controller.ts            /kitchens/me/orders
  dto/                                 quote-order.dto.ts, create-order.dto.ts, list-orders.dto.ts, cook-order-actions.dto.ts
  views.ts, presenters.ts (+ spec)     yanıt şekilleri (Swagger sınıfları) ve dönüştürücüler
  order.fixture.ts                     birim test fikstürleri
  orders.module.ts
src/payments/                          ödeme modülü
  domain/payment.ts                    Payment, PaymentStatus, NewPayment
  infrastructure/persistence/…         payment.entity.ts (generator), mapper, PaymentRepository (findByOrderId, update)
  provider/                            payment-provider.ts, dev-payment-provider.ts (+ spec), payment-provider.provider.ts (+ spec)
  config/                              payments.config.ts, payments-config.type.ts
  payments.service.ts (+ spec)         charge (402 paymentFailed), refund (refund_failed kaydı)
  payments.module.ts
src/kitchens/…                         minOrderKurus (generator), findById; dto spec
src/products/…                         findByIds
src/discovery/views.ts, presenters.ts  KitchenDetail.minOrderKurus
src/utils/http/all-exceptions.filter.ts  istemci hatasının `data`'sını geçirir (409 data.quote)
src/users/users.service.ts (+ spec)    hesap silme: 409 activeOrdersExist, sipariş adresleri temizliği
src/database/seeds/relational/order/   dev müşterisi + her durumdan sipariş
src/database/migrations/*              (generate) KitchenMinOrder, CreateOrders
test/utils/orders.ts                   e2e yardımcıları (giriş, mutfak, ürün, adres, test DB bağlantısı)
test/user/orders.e2e-spec.ts           uçtan uca sipariş akışı (Task 5–8'de büyür)
test/user/order-payment.e2e-spec.ts    DEV_PAYMENT_FAIL=true ile açılan API'ye karşı 402
CLAUDE.md                              API conventions'a Faz 3 kuralları
```

**Görev sırası ve neden:** Spec'teki sıra (ödeme → minOrderKurus → tablolar) yerine **minOrderKurus → tablolar (ödeme tablosu dahil) → ödeme davranışı** uygulanır: `payment.orderId` `order` tablosuna FK olduğundan ödeme entity'si sipariş tablolarıyla aynı migration'da üretilir; ödeme sağlayıcısı ve servisi bir sonraki görevde gelir. `quoteOrder` (Task 1) `Kitchen` tipine bağlanmasın diye `minOrderKurus`'u kendi `QuoteKitchen` tipinde taşır.

---

### Task 0: Başlangıç durumunu doğrula

**Files:** yok (yalnızca doğrulama)

- [ ] **Step 1: Servisleri ve dalı kontrol et**

Run: `git status --short && git branch --show-current && lsof -i :3001 -sTCP:LISTEN; pg_isready; grep AUTH_PHONE_DEV_VERIFIER .env`
Expected: dal `main`, çalışma ağacında yalnız bu plan/spec dosyaları (varsa); 3001'de node (API); Postgres "accepting connections"; `AUTH_PHONE_DEV_VERIFIER=true`. API çalışmıyorsa ayrı bir terminalde (arka planda) `npm run start:dev` başlat.

- [ ] **Step 2: Migration'lar uygulanmış mı**

Run: `npm run typeorm -- --dataSource=src/database/data-source.ts migration:show`
Expected: yedi migration'ın hepsi `[X]` (`CreateUser` … `CreateProduct`). `[ ]` varsa DURUP kullanıcıya bildir.

- [ ] **Step 3: Birim ve e2e paketlerini çalıştır**

Run: `npm test && npm run test:e2e -- --runInBand`
Expected: ikisi de PASS. Kırmızı test varsa DURUP kullanıcıya bildir — başlangıç bozuksa sonraki görevlerin sonucu yorumlanamaz.

---

### Task 1: Sipariş çekirdeği (saf kurallar + sipariş konfigürasyonu)

**Files:**
- Create: `src/orders/order.enums.ts`, `src/orders/order-status.ts`, `src/orders/order-codes.ts`, `src/orders/order-time.ts`, `src/orders/order-pricing.ts`
- Test: `src/orders/order-status.spec.ts`, `src/orders/order-codes.spec.ts`, `src/orders/order-time.spec.ts`, `src/orders/order-pricing.spec.ts`
- Create: `src/orders/config/orders-config.type.ts`, `src/orders/config/orders.config.ts`, `src/orders/config/orders.config.spec.ts`
- Modify: `src/config/config.type.ts`, `src/app.module.ts` (ConfigModule `load`), `env-example-relational`, `.env`

**Interfaces:**
- Consumes: `SaleType` (`src/catalog/catalog.enums.ts`), `deliveryFeeFor` (`src/catalog/delivery.ts`), `haversineKm`, `roundCoord`, `roundDistance`, `LatLng` (`src/catalog/geo.ts`), `openingState`, `istanbulClock`, `toMinutes` (`src/catalog/opening-state.ts`), `FieldErrors` (`src/catalog/field-errors.ts`), `validateConfig` (`src/utils/validate-config.ts`), `Kitchen`, `Product`, `Category`, `User` domain tipleri.
- Produces:
  - `enum OrderStatus { pending, accepted, preparing, ready, onTheWay = 'on_the_way', completed, rejected, cancelled, expired }`, `enum Fulfillment { pickup, delivery }`, `enum CancelledBy { customer, cook, system }`, `enum OrderReason { outOfIngredients = 'out_of_ingredients', tooBusy = 'too_busy', timeNotSuitable = 'time_not_suitable', other }`, `enum CookTab { new, preparing, ready, done }`, `enum OrderScope { active, past }` (değerler küçük harf string).
  - `ACTIVE_STATUSES`, `CLOSED_STATUSES`, `ROLLBACK_STATUSES: OrderStatus[]`; `type OrderAction = 'accept' | 'reject' | 'start' | 'ready' | 'dispatch' | 'complete' | 'cookCancel' | 'customerCancel' | 'expire'`; `type Transition = { from: OrderStatus[]; to: OrderStatus }`; `transitionFor(action: OrderAction, fulfillment: Fulfillment): Transition | null`; `canTransition(status: OrderStatus, action: OrderAction, fulfillment: Fulfillment): boolean`; `type OrderTimestamp`; `STAMP_FOR: Partial<Record<OrderStatus, OrderTimestamp>>`; `COOK_TAB_STATUSES: Record<CookTab, OrderStatus[]>`.
  - `ORDER_CODE_ALPHABET`, `type RandomInt = (max: number) => number`, `generateOrderCode(random?: RandomInt): string`, `generatePickupCode(random?: RandomInt): string`.
  - `istanbulDayStart(now: Date): Date`, `istanbulWeekStart(now: Date): Date`.
  - `type QuoteKitchen`, `type QuoteProduct`, `type QuoteItem = { productId: string; quantity: number }`, `type PricingConfig = { serviceFeePercent; deliveryBufferMinutes; coordPrecision }`, `type QuoteInput`, `type OrderIssueKind`, `type OrderIssue`, `type OrderBlocker`, `type OrderQuote`; `quoteOrder(input: QuoteInput): OrderQuote`; `estimatedMinutesFor(lines: { saleType: SaleType; prepMinutes: number | null }[], fulfillment: Fulfillment, deliveryBufferMinutes: number): number`; `estimatedReadyAt(acceptedAt: Date, minutes: number): Date`; `quoteFieldErrors(quote: OrderQuote, items: QuoteItem[]): FieldErrors`.
  - Config: `configService.getOrThrow('orders.acceptMinutes' | 'orders.deliveryBufferMinutes' | 'orders.serviceFeePercent', { infer: true })`.

- [ ] **Step 1: Enum'lar**

`src/orders/order.enums.ts`:

```ts
export enum OrderStatus {
  pending = 'pending',
  accepted = 'accepted',
  preparing = 'preparing',
  ready = 'ready',
  onTheWay = 'on_the_way',
  completed = 'completed',
  rejected = 'rejected',
  cancelled = 'cancelled',
  expired = 'expired',
}

export enum Fulfillment {
  pickup = 'pickup',
  delivery = 'delivery',
}

export enum CancelledBy {
  customer = 'customer',
  cook = 'cook',
  system = 'system',
}

/** Required for reject and the cook's cancel; null otherwise. */
export enum OrderReason {
  outOfIngredients = 'out_of_ingredients',
  tooBusy = 'too_busy',
  timeNotSuitable = 'time_not_suitable',
  other = 'other',
}

/** The cook's order tabs (GET /kitchens/me/orders?tab=). */
export enum CookTab {
  new = 'new',
  preparing = 'preparing',
  ready = 'ready',
  done = 'done',
}

/** The customer's order list (GET /orders?scope=). */
export enum OrderScope {
  active = 'active',
  past = 'past',
}
```

- [ ] **Step 2: Durum geçişleri — test**

`src/orders/order-status.spec.ts` (her durum × her eylem × her teslim tipi tablodan kontrol edilir):

```ts
import { CookTab, Fulfillment, OrderStatus } from './order.enums';
import {
  ACTIVE_STATUSES,
  CLOSED_STATUSES,
  COOK_TAB_STATUSES,
  OrderAction,
  canTransition,
  transitionFor,
} from './order-status';

const ACTIONS: OrderAction[] = [
  'accept',
  'reject',
  'start',
  'ready',
  'dispatch',
  'complete',
  'cookCancel',
  'customerCancel',
  'expire',
];

/** Every allowed (status, action, fulfillment); everything else is a 409. */
const ALLOWED = new Set([
  'pending:accept:pickup',
  'pending:accept:delivery',
  'pending:reject:pickup',
  'pending:reject:delivery',
  'pending:customerCancel:pickup',
  'pending:customerCancel:delivery',
  'pending:expire:pickup',
  'pending:expire:delivery',
  'accepted:start:pickup',
  'accepted:start:delivery',
  'accepted:cookCancel:pickup',
  'accepted:cookCancel:delivery',
  'preparing:ready:pickup',
  'preparing:ready:delivery',
  'preparing:cookCancel:pickup',
  'preparing:cookCancel:delivery',
  'ready:dispatch:delivery',
  'ready:complete:pickup',
  'on_the_way:complete:delivery',
]);

describe('canTransition', () => {
  const cases = Object.values(OrderStatus).flatMap((status) =>
    ACTIONS.flatMap((action) =>
      Object.values(Fulfillment).map(
        (fulfillment) => [status, action, fulfillment] as const,
      ),
    ),
  );

  it.each(cases)(
    'should decide %s × %s × %s from the transition table',
    (status, action, fulfillment) => {
      expect(canTransition(status, action, fulfillment)).toBe(
        ALLOWED.has(`${status}:${action}:${fulfillment}`),
      );
    },
  );
});

describe('transitionFor', () => {
  it('should map each action to its target status', () => {
    expect(transitionFor('accept', Fulfillment.pickup)?.to).toBe(
      OrderStatus.accepted,
    );
    expect(transitionFor('reject', Fulfillment.pickup)?.to).toBe(
      OrderStatus.rejected,
    );
    expect(transitionFor('dispatch', Fulfillment.delivery)?.to).toBe(
      OrderStatus.onTheWay,
    );
    expect(transitionFor('complete', Fulfillment.delivery)).toEqual({
      from: [OrderStatus.onTheWay],
      to: OrderStatus.completed,
    });
    expect(transitionFor('cookCancel', Fulfillment.delivery)?.to).toBe(
      OrderStatus.cancelled,
    );
    expect(transitionFor('expire', Fulfillment.pickup)?.to).toBe(
      OrderStatus.expired,
    );
  });

  it('should not dispatch a pickup order', () => {
    expect(transitionFor('dispatch', Fulfillment.pickup)).toBeNull();
  });
});

describe('status sets', () => {
  it('should split the nine statuses into active and closed', () => {
    expect([...ACTIVE_STATUSES, ...CLOSED_STATUSES].sort()).toEqual(
      Object.values(OrderStatus).sort(),
    );
  });

  it('should map cook tabs to statuses', () => {
    expect(COOK_TAB_STATUSES[CookTab.new]).toEqual([OrderStatus.pending]);
    expect(COOK_TAB_STATUSES[CookTab.preparing]).toEqual([
      OrderStatus.accepted,
      OrderStatus.preparing,
    ]);
    expect(COOK_TAB_STATUSES[CookTab.ready]).toEqual([
      OrderStatus.ready,
      OrderStatus.onTheWay,
    ]);
    expect(COOK_TAB_STATUSES[CookTab.done]).toEqual(CLOSED_STATUSES);
  });
});
```

Run: `npx jest src/orders/order-status.spec.ts` → FAIL (`Cannot find module './order-status'`).

- [ ] **Step 3: Durum geçişleri — kod**

`src/orders/order-status.ts`:

```ts
import { CookTab, Fulfillment, OrderStatus } from './order.enums';

export const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.pending,
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
  OrderStatus.onTheWay,
];

export const CLOSED_STATUSES: OrderStatus[] = [
  OrderStatus.completed,
  OrderStatus.rejected,
  OrderStatus.cancelled,
  OrderStatus.expired,
];

/** Closing into these hands the portions and the money back. */
export const ROLLBACK_STATUSES: OrderStatus[] = [
  OrderStatus.rejected,
  OrderStatus.cancelled,
  OrderStatus.expired,
];

export type OrderAction =
  | 'accept'
  | 'reject'
  | 'start'
  | 'ready'
  | 'dispatch'
  | 'complete'
  | 'cookCancel'
  | 'customerCancel'
  | 'expire';

export type Transition = { from: OrderStatus[]; to: OrderStatus };

const TRANSITIONS: Record<
  OrderAction,
  (fulfillment: Fulfillment) => Transition | null
> = {
  accept: () => ({ from: [OrderStatus.pending], to: OrderStatus.accepted }),
  reject: () => ({ from: [OrderStatus.pending], to: OrderStatus.rejected }),
  start: () => ({ from: [OrderStatus.accepted], to: OrderStatus.preparing }),
  ready: () => ({ from: [OrderStatus.preparing], to: OrderStatus.ready }),
  dispatch: (fulfillment) =>
    fulfillment === Fulfillment.delivery
      ? { from: [OrderStatus.ready], to: OrderStatus.onTheWay }
      : null,
  // Pickup completes from `ready` with the pickup code; delivery from `on_the_way`.
  complete: (fulfillment) => ({
    from: [
      fulfillment === Fulfillment.pickup
        ? OrderStatus.ready
        : OrderStatus.onTheWay,
    ],
    to: OrderStatus.completed,
  }),
  cookCancel: () => ({
    from: [OrderStatus.accepted, OrderStatus.preparing],
    to: OrderStatus.cancelled,
  }),
  customerCancel: () => ({
    from: [OrderStatus.pending],
    to: OrderStatus.cancelled,
  }),
  expire: () => ({ from: [OrderStatus.pending], to: OrderStatus.expired }),
};

/** null when the action never applies to this fulfillment (dispatch on pickup). */
export function transitionFor(
  action: OrderAction,
  fulfillment: Fulfillment,
): Transition | null {
  return TRANSITIONS[action](fulfillment);
}

export function canTransition(
  status: OrderStatus,
  action: OrderAction,
  fulfillment: Fulfillment,
): boolean {
  return transitionFor(action, fulfillment)?.from.includes(status) ?? false;
}

export type OrderTimestamp =
  | 'acceptedAt'
  | 'preparingAt'
  | 'readyAt'
  | 'onTheWayAt'
  | 'completedAt'
  | 'closedAt';

/** The timestamp written when an order enters a status. */
export const STAMP_FOR: Partial<Record<OrderStatus, OrderTimestamp>> = {
  [OrderStatus.accepted]: 'acceptedAt',
  [OrderStatus.preparing]: 'preparingAt',
  [OrderStatus.ready]: 'readyAt',
  [OrderStatus.onTheWay]: 'onTheWayAt',
  [OrderStatus.completed]: 'completedAt',
  [OrderStatus.rejected]: 'closedAt',
  [OrderStatus.cancelled]: 'closedAt',
  [OrderStatus.expired]: 'closedAt',
};

/** `done` is further limited to orders closed today (Istanbul). */
export const COOK_TAB_STATUSES: Record<CookTab, OrderStatus[]> = {
  [CookTab.new]: [OrderStatus.pending],
  [CookTab.preparing]: [OrderStatus.accepted, OrderStatus.preparing],
  [CookTab.ready]: [OrderStatus.ready, OrderStatus.onTheWay],
  [CookTab.done]: CLOSED_STATUSES,
};
```

Run: `npx jest src/orders/order-status.spec.ts` → PASS (166 test).

- [ ] **Step 4: Kodlar ve İstanbul günü — test**

`src/orders/order-codes.spec.ts`:

```ts
import {
  ORDER_CODE_ALPHABET,
  generateOrderCode,
  generatePickupCode,
} from './order-codes';

describe('generateOrderCode', () => {
  it('should be S- and four characters from the unambiguous alphabet', () => {
    for (let run = 0; run < 200; run++) {
      expect(generateOrderCode()).toMatch(/^S-[23456789A-HJKMNP-Z]{4}$/);
    }
  });

  it('should leave out 0, 1, I, L and O', () => {
    expect(ORDER_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(ORDER_CODE_ALPHABET).toHaveLength(31);
  });

  it('should use the given random source', () => {
    expect(generateOrderCode(() => 0)).toBe('S-2222');
    expect(generateOrderCode((max) => max - 1)).toBe('S-ZZZZ');
  });
});

describe('generatePickupCode', () => {
  it('should be four digits, zero-padded', () => {
    expect(generatePickupCode(() => 7)).toBe('0007');
    expect(generatePickupCode((max) => max - 1)).toBe('9999');
    expect(generatePickupCode()).toMatch(/^\d{4}$/);
  });
});
```

`src/orders/order-time.spec.ts` (2026-10-12 Pazartesi, 2026-10-18 Pazar):

```ts
import { istanbulDayStart, istanbulWeekStart } from './order-time';

describe('istanbulDayStart', () => {
  it('should be Istanbul midnight, 21:00 UTC the day before', () => {
    expect(istanbulDayStart(new Date('2026-10-12T09:30:45.123Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should already be the next day in Istanbul after 21:00 UTC', () => {
    expect(istanbulDayStart(new Date('2026-10-11T22:30:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should keep an exact midnight', () => {
    expect(istanbulDayStart(new Date('2026-10-11T21:00:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });
});

describe('istanbulWeekStart', () => {
  it('should go back to Monday 00:00 Istanbul time', () => {
    // 2026-10-18 is a Sunday; that week began Monday 2026-10-12.
    expect(istanbulWeekStart(new Date('2026-10-18T10:00:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should be the same day on a Monday', () => {
    expect(istanbulWeekStart(new Date('2026-10-12T09:30:00Z'))).toEqual(
      new Date('2026-10-11T21:00:00Z'),
    );
  });
});
```

Run: `npx jest src/orders/order-codes.spec.ts src/orders/order-time.spec.ts` → FAIL (modüller yok).

- [ ] **Step 5: Kodlar ve İstanbul günü — kod**

`src/orders/order-codes.ts`:

```ts
import { randomInt } from 'crypto';

/** No 0/O or 1/I/L: the code is read aloud and typed back. */
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A uniform integer in [0, max). */
export type RandomInt = (max: number) => number;

const secureRandom: RandomInt = (max) => randomInt(max);

/** Display code `S-7K3F`; the order repository retries on a collision. */
export function generateOrderCode(random: RandomInt = secureRandom): string {
  let code = 'S-';

  for (let index = 0; index < 4; index++) {
    code += ORDER_CODE_ALPHABET[random(ORDER_CODE_ALPHABET.length)];
  }

  return code;
}

/** Four digits the customer shows and the cook types to complete a pickup. */
export function generatePickupCode(random: RandomInt = secureRandom): string {
  return String(random(10_000)).padStart(4, '0');
}
```

`src/orders/order-time.ts`:

```ts
import { istanbulClock, toMinutes } from '../catalog/opening-state';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** 00:00 Istanbul time of the day `now` falls in (Turkey has no DST). */
export function istanbulDayStart(now: Date): Date {
  const { time } = istanbulClock(now);

  return new Date(
    now.getTime() - (now.getTime() % MINUTE_MS) - toMinutes(time) * MINUTE_MS,
  );
}

/** Monday 00:00 Istanbul time of the week `now` falls in. */
export function istanbulWeekStart(now: Date): Date {
  const { dayOfWeek } = istanbulClock(now);

  return new Date(istanbulDayStart(now).getTime() - (dayOfWeek - 1) * DAY_MS);
}
```

Run: `npx jest src/orders/order-codes.spec.ts src/orders/order-time.spec.ts` → PASS (9 test).

- [ ] **Step 6: Fiyat ve uygunluk — test**

`src/orders/order-pricing.spec.ts` (mutfak noktası 3 haneye yuvarlanınca `40.988, 29.022`; `north(km)` bu noktanın km kuzeyi):

```ts
import { SaleType } from '../catalog/catalog.enums';
import { Fulfillment } from './order.enums';
import {
  QuoteInput,
  QuoteKitchen,
  QuoteProduct,
  estimatedMinutesFor,
  estimatedReadyAt,
  quoteFieldErrors,
  quoteOrder,
} from './order-pricing';

// 2026-10-12 is a Monday; 09:30 UTC is 12:30 in Istanbul.
const NOW = new Date('2026-10-12T09:30:00Z');
const KM_PER_DEGREE = (Math.PI / 180) * 6371;

const kitchen: QuoteKitchen = {
  id: 'k1',
  ownerId: 7,
  // Rounded to 3 decimals: 40.988, 29.022.
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 1500 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  freeDeliveryMinKurus: 30000,
  minOrderKurus: null,
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
};

/** `km` north of the rounded kitchen point. */
const north = (km: number) => ({
  latitude: 40.988 + km / KM_PER_DEGREE,
  longitude: 29.022,
});

const product = (overrides: Partial<QuoteProduct> = {}): QuoteProduct => ({
  id: 'manti',
  kitchenId: 'k1',
  priceKurus: 14000,
  saleType: SaleType.onDemand,
  prepMinutes: 45,
  portionsAvailable: null,
  isActive: true,
  category: { isActive: true },
  ...overrides,
});

const sutlac = product({
  id: 'sutlac',
  priceKurus: 6500,
  saleType: SaleType.dailyPortion,
  prepMinutes: null,
  portionsAvailable: 8,
});

const input = (overrides: Partial<QuoteInput> = {}): QuoteInput => ({
  kitchen,
  products: [product(), sutlac],
  items: [
    { productId: 'manti', quantity: 2 },
    { productId: 'sutlac', quantity: 1 },
  ],
  fulfillment: Fulfillment.pickup,
  address: null,
  customerId: 9,
  now: NOW,
  config: {
    serviceFeePercent: 5,
    deliveryBufferMinutes: 15,
    coordPrecision: 3,
  },
  ...overrides,
});

describe('quoteOrder', () => {
  it('should price a pickup order', () => {
    expect(quoteOrder(input())).toEqual({
      subtotalKurus: 34500,
      deliveryFeeKurus: 0,
      serviceFeeKurus: 1725,
      totalKurus: 36225,
      freeDeliveryRemainingKurus: null,
      minOrderRemainingKurus: null,
      distanceKm: null,
      estimatedMinutes: 45,
      issues: [],
      blockers: [],
      canOrder: true,
    });
  });

  it('should charge the delivery tier below the free-delivery threshold', () => {
    const quote = quoteOrder(
      input({
        fulfillment: Fulfillment.delivery,
        address: north(3),
        items: [{ productId: 'manti', quantity: 1 }],
      }),
    );

    expect(quote).toMatchObject({
      subtotalKurus: 14000,
      deliveryFeeKurus: 2500,
      serviceFeeKurus: 700,
      totalKurus: 17200,
      freeDeliveryRemainingKurus: 16000,
      distanceKm: 3,
      estimatedMinutes: 60,
      canOrder: true,
    });
  });

  it('should deliver for free from the threshold on (≥)', () => {
    const at = (priceKurus: number) =>
      quoteOrder(
        input({
          fulfillment: Fulfillment.delivery,
          address: north(1),
          products: [product({ priceKurus })],
          items: [{ productId: 'manti', quantity: 3 }],
        }),
      );

    expect(at(10000)).toMatchObject({
      subtotalKurus: 30000,
      deliveryFeeKurus: 0,
      freeDeliveryRemainingKurus: null,
    });
    expect(at(9999)).toMatchObject({
      subtotalKurus: 29997,
      deliveryFeeKurus: 1500,
      freeDeliveryRemainingKurus: 3,
    });
  });

  it('should round the service fee to the nearest kuruş', () => {
    const fee = (priceKurus: number) =>
      quoteOrder(
        input({
          products: [product({ priceKurus })],
          items: [{ productId: 'manti', quantity: 1 }],
        }),
      ).serviceFeeKurus;

    expect(fee(14009)).toBe(700); // 700.45
    expect(fee(14010)).toBe(701); // 700.5
    expect(fee(14030)).toBe(702); // 701.5
  });

  it('should block an address beyond the last tier', () => {
    expect(
      quoteOrder(
        input({ fulfillment: Fulfillment.delivery, address: north(6) }),
      ),
    ).toMatchObject({
      deliveryFeeKurus: 0,
      distanceKm: 6,
      blockers: ['out_of_range'],
      canOrder: false,
    });
  });

  it('should block a fulfillment the kitchen does not offer', () => {
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, pickupEnabled: false } }))
        .blockers,
    ).toEqual(['fulfillment_unavailable']);
    expect(
      quoteOrder(
        input({
          kitchen: { ...kitchen, deliveryEnabled: false },
          fulfillment: Fulfillment.delivery,
          address: north(1),
        }),
      ),
    ).toMatchObject({
      blockers: ['fulfillment_unavailable'],
      distanceKm: null,
    });
  });

  it('should block a closed or paused kitchen', () => {
    expect(
      quoteOrder(input({ now: new Date('2026-10-12T18:00:00Z') })).blockers,
    ).toEqual(['kitchen_closed']);
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, isPaused: true } })).blockers,
    ).toEqual(['kitchen_closed']);
  });

  it('should block an order below the kitchen minimum', () => {
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, minOrderKurus: 40000 } })),
    ).toMatchObject({
      blockers: ['below_minimum'],
      minOrderRemainingKurus: 5500,
    });
    expect(
      quoteOrder(input({ kitchen: { ...kitchen, minOrderKurus: 34500 } })),
    ).toMatchObject({ blockers: [], minOrderRemainingKurus: null });
  });

  it('should block ordering from one’s own kitchen', () => {
    expect(quoteOrder(input({ customerId: '7' })).blockers).toEqual([
      'own_kitchen',
    ]);
  });

  it('should report too few daily portions with what is left', () => {
    const quote = quoteOrder(
      input({ items: [{ productId: 'sutlac', quantity: 9 }] }),
    );

    expect(quote.issues).toEqual([
      { productId: 'sutlac', kind: 'insufficient_portions', available: 8 },
    ]);
    expect(quote.canOrder).toBe(false);
  });

  it('should report missing, inactive and foreign products as unavailable but still price them', () => {
    const quote = quoteOrder(
      input({
        products: [
          product({ id: 'off', isActive: false }),
          product({ id: 'foreign', kitchenId: 'k2' }),
          product({ id: 'hidden', category: { isActive: false } }),
        ],
        items: [
          { productId: 'gone', quantity: 1 },
          { productId: 'off', quantity: 1 },
          { productId: 'foreign', quantity: 1 },
          { productId: 'hidden', quantity: 1 },
        ],
      }),
    );

    expect(quote.issues).toEqual([
      { productId: 'gone', kind: 'unavailable' },
      { productId: 'off', kind: 'unavailable' },
      { productId: 'foreign', kind: 'unavailable' },
      { productId: 'hidden', kind: 'unavailable' },
    ]);
    expect(quote.subtotalKurus).toBe(42000);
    expect(quote.estimatedMinutes).toBe(0);
  });
});

describe('estimatedMinutesFor', () => {
  it('should take the longest on-demand prep and treat daily portions as ready', () => {
    const lines = [
      { saleType: SaleType.onDemand, prepMinutes: 20 },
      { saleType: SaleType.onDemand, prepMinutes: 45 },
      { saleType: SaleType.dailyPortion, prepMinutes: null },
    ];

    expect(estimatedMinutesFor(lines, Fulfillment.pickup, 15)).toBe(45);
    expect(estimatedMinutesFor(lines, Fulfillment.delivery, 15)).toBe(60);
    expect(estimatedMinutesFor([], Fulfillment.pickup, 15)).toBe(0);
  });
});

describe('estimatedReadyAt', () => {
  it('should add the minutes to the acceptance time', () => {
    expect(estimatedReadyAt(NOW, 60)).toEqual(new Date('2026-10-12T10:30:00Z'));
  });
});

describe('quoteFieldErrors', () => {
  it('should point issues at their item and blockers at the request field', () => {
    const quote = quoteOrder(
      input({
        kitchen: { ...kitchen, isPaused: true, minOrderKurus: 100000 },
        fulfillment: Fulfillment.delivery,
        address: north(6),
        items: [
          { productId: 'manti', quantity: 1 },
          { productId: 'sutlac', quantity: 9 },
        ],
      }),
    );

    expect(
      quoteFieldErrors(quote, [
        { productId: 'manti', quantity: 1 },
        { productId: 'sutlac', quantity: 9 },
      ]),
    ).toEqual({
      'items.1.productId': 'insufficient_portions',
      kitchenId: 'kitchen_closed, below_minimum',
      addressId: 'out_of_range',
    });
  });
});
```

Run: `npx jest src/orders/order-pricing.spec.ts` → FAIL (modül yok).

- [ ] **Step 7: Fiyat ve uygunluk — kod**

`src/orders/order-pricing.ts`:

```ts
import { SaleType } from '../catalog/catalog.enums';
import { deliveryFeeFor } from '../catalog/delivery';
import { FieldErrors } from '../catalog/field-errors';
import { LatLng, haversineKm, roundCoord, roundDistance } from '../catalog/geo';
import { openingState } from '../catalog/opening-state';
import { Category } from '../categories/domain/category';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
import { User } from '../users/domain/user';
import { Fulfillment } from './order.enums';

export type QuoteKitchen = Pick<
  Kitchen,
  | 'id'
  | 'ownerId'
  | 'latitude'
  | 'longitude'
  | 'pickupEnabled'
  | 'deliveryEnabled'
  | 'deliveryTiers'
  | 'freeDeliveryMinKurus'
  | 'hours'
  | 'isPaused'
> & { minOrderKurus: number | null };

export type QuoteProduct = Pick<
  Product,
  | 'id'
  | 'kitchenId'
  | 'priceKurus'
  | 'saleType'
  | 'prepMinutes'
  | 'portionsAvailable'
  | 'isActive'
> & { category: Pick<Category, 'isActive'> };

export type QuoteItem = { productId: string; quantity: number };

export type PricingConfig = {
  /** ORDER_SERVICE_FEE_PERCENT */
  serviceFeePercent: number;
  /** ORDER_DELIVERY_BUFFER_MINUTES */
  deliveryBufferMinutes: number;
  /** DISCOVERY_COORD_PRECISION — distance is measured from the rounded kitchen point. */
  coordPrecision: number;
};

export type QuoteInput = {
  kitchen: QuoteKitchen;
  /** The requested products that still exist (soft-deleted ones are simply missing). */
  products: QuoteProduct[];
  items: QuoteItem[];
  fulfillment: Fulfillment;
  /** The delivery address; null for pickup. */
  address: LatLng | null;
  customerId: User['id'];
  now: Date;
  config: PricingConfig;
};

export type OrderIssueKind = 'unavailable' | 'insufficient_portions';

export type OrderIssue = {
  productId: string;
  kind: OrderIssueKind;
  /** Portions left, for insufficient_portions. */
  available?: number;
};

export type OrderBlocker =
  | 'kitchen_closed'
  | 'fulfillment_unavailable'
  | 'out_of_range'
  | 'below_minimum'
  | 'own_kitchen';

export type OrderQuote = {
  subtotalKurus: number;
  deliveryFeeKurus: number;
  serviceFeeKurus: number;
  totalKurus: number;
  /** Delivery only, while a free-delivery threshold is set and not reached. */
  freeDeliveryRemainingKurus: number | null;
  /** While a minimum is set and not reached. */
  minOrderRemainingKurus: number | null;
  /** Delivery only (0.1 km), from the rounded kitchen point. */
  distanceKm: number | null;
  estimatedMinutes: number;
  issues: OrderIssue[];
  blockers: OrderBlocker[];
  canOrder: boolean;
};

const MINUTE_MS = 60_000;

/** Longest on-demand prep (daily portions are ready: 0) + the delivery buffer. */
export function estimatedMinutesFor(
  lines: { saleType: SaleType; prepMinutes: number | null }[],
  fulfillment: Fulfillment,
  deliveryBufferMinutes: number,
): number {
  const prep = Math.max(
    0,
    ...lines.map((line) =>
      line.saleType === SaleType.onDemand ? (line.prepMinutes ?? 0) : 0,
    ),
  );

  return (
    prep + (fulfillment === Fulfillment.delivery ? deliveryBufferMinutes : 0)
  );
}

export function estimatedReadyAt(acceptedAt: Date, minutes: number): Date {
  return new Date(acceptedAt.getTime() + minutes * MINUTE_MS);
}

/**
 * Prices a cart and says whether it can be ordered. Used by both
 * POST /orders/quote and POST /orders, so the two never disagree.
 */
export function quoteOrder(input: QuoteInput): OrderQuote {
  const { kitchen, fulfillment, config } = input;
  const byId = new Map(input.products.map((product) => [product.id, product]));
  const issues: OrderIssue[] = [];
  const lines: QuoteProduct[] = [];
  let subtotalKurus = 0;

  for (const item of input.items) {
    const product = byId.get(item.productId);

    if (!product) {
      issues.push({ productId: item.productId, kind: 'unavailable' });
      continue;
    }

    // Every requested item counts, sound or not; canOrder says whether it can go.
    subtotalKurus += product.priceKurus * item.quantity;

    if (
      product.kitchenId !== kitchen.id ||
      !product.isActive ||
      !product.category.isActive
    ) {
      issues.push({ productId: product.id, kind: 'unavailable' });
      continue;
    }

    lines.push(product);

    const available = product.portionsAvailable ?? 0;

    if (
      product.saleType === SaleType.dailyPortion &&
      available < item.quantity
    ) {
      issues.push({
        productId: product.id,
        kind: 'insufficient_portions',
        available,
      });
    }
  }

  const blockers: OrderBlocker[] = [];

  if (!openingState(kitchen.hours, kitchen.isPaused, input.now).isOpenNow) {
    blockers.push('kitchen_closed');
  }

  let deliveryFeeKurus = 0;
  let distanceKm: number | null = null;

  if (fulfillment === Fulfillment.pickup) {
    if (!kitchen.pickupEnabled) {
      blockers.push('fulfillment_unavailable');
    }
  } else if (!kitchen.deliveryEnabled) {
    blockers.push('fulfillment_unavailable');
  } else {
    const exactKm = input.address
      ? haversineKm(input.address, {
          latitude: roundCoord(kitchen.latitude, config.coordPrecision),
          longitude: roundCoord(kitchen.longitude, config.coordPrecision),
        })
      : Number.POSITIVE_INFINITY;
    const fee = deliveryFeeFor(kitchen.deliveryTiers, exactKm);

    distanceKm = Number.isFinite(exactKm) ? roundDistance(exactKm) : null;

    if (fee === null) {
      blockers.push('out_of_range');
    } else {
      const free =
        kitchen.freeDeliveryMinKurus !== null &&
        subtotalKurus >= kitchen.freeDeliveryMinKurus;
      deliveryFeeKurus = free ? 0 : fee;
    }
  }

  if (kitchen.minOrderKurus !== null && subtotalKurus < kitchen.minOrderKurus) {
    blockers.push('below_minimum');
  }

  if (String(kitchen.ownerId) === String(input.customerId)) {
    blockers.push('own_kitchen');
  }

  const serviceFeeKurus = Math.round(
    (subtotalKurus * config.serviceFeePercent) / 100,
  );

  return {
    subtotalKurus,
    deliveryFeeKurus,
    serviceFeeKurus,
    totalKurus: subtotalKurus + deliveryFeeKurus + serviceFeeKurus,
    freeDeliveryRemainingKurus:
      fulfillment === Fulfillment.delivery &&
      kitchen.freeDeliveryMinKurus !== null &&
      subtotalKurus < kitchen.freeDeliveryMinKurus
        ? kitchen.freeDeliveryMinKurus - subtotalKurus
        : null,
    minOrderRemainingKurus:
      kitchen.minOrderKurus !== null && subtotalKurus < kitchen.minOrderKurus
        ? kitchen.minOrderKurus - subtotalKurus
        : null,
    distanceKm,
    estimatedMinutes: estimatedMinutesFor(
      lines,
      fulfillment,
      config.deliveryBufferMinutes,
    ),
    issues,
    blockers,
    canOrder: issues.length === 0 && blockers.length === 0,
  };
}

const BLOCKER_FIELD: Record<OrderBlocker, string> = {
  kitchen_closed: 'kitchenId',
  below_minimum: 'kitchenId',
  own_kitchen: 'kitchenId',
  fulfillment_unavailable: 'fulfillment',
  out_of_range: 'addressId',
};

/** POST /orders refuses a quote that cannot be ordered with these 422 fields. */
export function quoteFieldErrors(
  quote: OrderQuote,
  items: QuoteItem[],
): FieldErrors {
  const errors: FieldErrors = {};
  const add = (field: string, message: string) => {
    errors[field] = errors[field] ? `${errors[field]}, ${message}` : message;
  };

  for (const issue of quote.issues) {
    const index = items.findIndex((item) => item.productId === issue.productId);
    add(`items.${index}.productId`, issue.kind);
  }

  for (const blocker of quote.blockers) {
    add(BLOCKER_FIELD[blocker], blocker);
  }

  return errors;
}
```

Run: `npx jest src/orders/order-pricing.spec.ts` → PASS (14 test).

- [ ] **Step 8: Sipariş konfigürasyonu — test**

`src/orders/config/orders.config.spec.ts`:

```ts
import ordersConfig from './orders.config';

const KEYS = [
  'ORDER_ACCEPT_MINUTES',
  'ORDER_DELIVERY_BUFFER_MINUTES',
  'ORDER_SERVICE_FEE_PERCENT',
];

describe('ordersConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    process.env = saved;
  });

  it('should default to 3 minutes, 15 minutes and 5 percent', () => {
    expect(ordersConfig()).toEqual({
      acceptMinutes: 3,
      deliveryBufferMinutes: 15,
      serviceFeePercent: 5,
    });
  });

  it('should read the environment', () => {
    process.env.ORDER_ACCEPT_MINUTES = '5';
    process.env.ORDER_DELIVERY_BUFFER_MINUTES = '20';
    process.env.ORDER_SERVICE_FEE_PERCENT = '7.5';

    expect(ordersConfig()).toEqual({
      acceptMinutes: 5,
      deliveryBufferMinutes: 20,
      serviceFeePercent: 7.5,
    });
  });

  it('should refuse out-of-range values', () => {
    process.env.ORDER_ACCEPT_MINUTES = '0';

    expect(() => ordersConfig()).toThrow();
  });
});
```

Run: `npx jest src/orders/config` → FAIL (modül yok).

- [ ] **Step 9: Sipariş konfigürasyonu — kod**

`src/orders/config/orders-config.type.ts`:

```ts
export type OrdersConfig = {
  /** A pending order expires after this many minutes without an answer. */
  acceptMinutes: number;
  /** Added to the prep time of delivery orders. */
  deliveryBufferMinutes: number;
  /** Platform fee on the subtotal, paid by the customer. */
  serviceFeePercent: number;
};
```

`src/orders/config/orders.config.ts` (Faz 2 `discovery.config.ts` deseni):

```ts
import { registerAs } from '@nestjs/config';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { OrdersConfig } from './orders-config.type';

class EnvironmentVariablesValidator {
  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  ORDER_ACCEPT_MINUTES: number;

  @IsInt()
  @Min(0)
  @Max(240)
  @IsOptional()
  ORDER_DELIVERY_BUFFER_MINUTES: number;

  @IsNumber()
  @Min(0)
  @Max(50)
  @IsOptional()
  ORDER_SERVICE_FEE_PERCENT: number;
}

export default registerAs<OrdersConfig>('orders', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    acceptMinutes: process.env.ORDER_ACCEPT_MINUTES
      ? parseInt(process.env.ORDER_ACCEPT_MINUTES, 10)
      : 3,
    deliveryBufferMinutes: process.env.ORDER_DELIVERY_BUFFER_MINUTES
      ? parseInt(process.env.ORDER_DELIVERY_BUFFER_MINUTES, 10)
      : 15,
    serviceFeePercent: process.env.ORDER_SERVICE_FEE_PERCENT
      ? Number(process.env.ORDER_SERVICE_FEE_PERCENT)
      : 5,
  };
});
```

`src/config/config.type.ts` — import ve alan ekle:

```ts
import { OrdersConfig } from '../orders/config/orders-config.type';
// …
export type AllConfigType = {
  // …mevcut alanlar (mail: MailConfig'in altına)
  orders: OrdersConfig;
};
```

`src/app.module.ts` — `import mailConfig from './mail/config/mail.config';` satırının altına `import ordersConfig from './orders/config/orders.config';` ekle; `ConfigModule.forRoot({ load: [...] })` listesinde `appleConfig,`'ten sonra `ordersConfig,` ekle.

`env-example-relational` ve `.env` sonuna:

```
ORDER_ACCEPT_MINUTES=3
ORDER_DELIVERY_BUFFER_MINUTES=15
ORDER_SERVICE_FEE_PERCENT=5
```

Run: `npx jest src/orders && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (192 test), tip hatası yok.

- [ ] **Step 10: Commit**

```bash
git add src/orders src/config/config.type.ts src/app.module.ts env-example-relational
git commit -m "feat(orders): add status machine, pricing, codes and order config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`.env` commit edilmez.)

---

### Task 2: Mutfak minimum sipariş tutarı (`minOrderKurus`)

**Files:**
- Generate/Modify (son halleri aşağıda): `src/kitchens/domain/kitchen.ts`, `src/kitchens/infrastructure/persistence/relational/entities/kitchen.entity.ts`, `src/kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper.ts`, `src/kitchens/dto/create-kitchen.dto.ts`
- Modify: `src/kitchens/kitchens.service.ts`, `src/kitchens/kitchens.service.spec.ts`, `src/kitchens/infrastructure/persistence/kitchen.repository.ts`, `src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts`, `src/discovery/views.ts`, `src/discovery/presenters.ts`, `src/discovery/presenters.spec.ts`
- Create: `src/kitchens/dto/create-kitchen.dto.spec.ts`
- Create (generate): `src/database/migrations/<timestamp>-KitchenMinOrder.ts`

**Interfaces:**
- Consumes: mevcut `KitchensService`, `KitchenRepository`, `KitchenMapper`, `kitchenDetail` presenter.
- Produces:
  - `Kitchen.minOrderKurus: number | null` (DB `integer NULL`), `CreateKitchenDto.minOrderKurus?: number | null` (`@IsInt() @Min(0) @Max(100_000)`, `UpdateKitchenDto` `PartialType` ile devralır).
  - `KitchenRepository.findById(id: Kitchen['id']): Promise<NullableType<Kitchen>>` (silinmemiş), `KitchensService.findById(id: Kitchen['id']): Promise<Kitchen | null>` (Task 5 teklif buradan başlar).
  - `KitchenDetail.minOrderKurus: number | null` (`GET /discover/kitchens/:id`).

- [ ] **Step 1: DTO testi (önce kırmızı)**

`src/kitchens/dto/create-kitchen.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateKitchenDto } from './create-kitchen.dto';
import { UpdateKitchenDto } from './update-kitchen.dto';

const invalidFields = async (dto: new () => object, body: object) =>
  (await validate(plainToInstance(dto, body))).map((error) => error.property);

describe('minOrderKurus', () => {
  it('should accept 0 to 100000 kuruş and null', async () => {
    for (const minOrderKurus of [0, 15000, 100_000, null]) {
      expect(await invalidFields(UpdateKitchenDto, { minOrderKurus })).toEqual(
        [],
      );
    }
  });

  it('should reject negative, too large and fractional amounts', async () => {
    for (const minOrderKurus of [-1, 100_001, 150.5, '150']) {
      expect(await invalidFields(UpdateKitchenDto, { minOrderKurus })).toEqual([
        'minOrderKurus',
      ]);
    }
  });

  it('should be optional when the kitchen is opened', async () => {
    expect(
      await invalidFields(CreateKitchenDto, {
        name: 'Ayşe Teyze Mutfağı',
        addressId: '0b8f0c84-8f8a-4a8e-9a3b-2f7a1c6e5d4b',
        pickupEnabled: true,
        deliveryEnabled: false,
        deliveryTiers: [],
        hours: [],
      }),
    ).toEqual([]);
  });
});
```

Run: `npx jest src/kitchens/dto/create-kitchen.dto.spec.ts` → FAIL (alan tanımsız olduğu için `-1`, `100001`… doğrulanmıyor; "reject" testi kırmızı).

- [ ] **Step 2: Alanı generator ile ekle**

```bash
npm run add:property:to-relational -- --name Kitchen --property minOrderKurus --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
```

Kontrol: `git diff --stat src/kitchens` → domain, entity, mapper ve `create-kitchen.dto.ts` değişmiş. Generator mapper'a `Object.assign(...)` içine satır enjekte eder (sözdizimi bozulur, lint uyarısı normal); Step 3'te dosyalar son haline getirilir.

- [ ] **Step 3: Generator çıktısını son haline getir**

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

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  minOrderKurus: number | null;

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

  @Column({ type: Number, nullable: true })
  minOrderKurus: number | null;

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

`src/kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper.ts` — dosyanın tamamı (`toPersistence` alanı `fields` yayılımıyla zaten taşır):

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
      minOrderKurus: raw.minOrderKurus,
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

`src/kitchens/dto/create-kitchen.dto.ts` — dosyanın tamamı (generator'ın eklediği `IsNumber` importu ve blok gider):

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

  @ApiProperty({
    format: 'uuid',
    description: 'Kullanıcının adreslerinden biri; kopyalanır',
  })
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

  @ApiPropertyOptional({
    nullable: true,
    description: 'kuruş, 0–100000; ara toplam altındaysa sipariş verilemez',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  minOrderKurus?: number | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => KitchenHourDto)
  hours: KitchenHourDto[];
}
```

Run: `npx jest src/kitchens/dto/create-kitchen.dto.spec.ts` → PASS (3 test).

- [ ] **Step 4: Servis — test**

`src/kitchens/kitchens.service.spec.ts` — `KitchensService.create` ilk testindeki `toMatchObject` bloğunda `freeDeliveryMinKurus: null,` satırının altına ekle:

```ts
      minOrderKurus: null,
```

`describe('KitchensService.update', …)` içinde `it('should re-copy the address when addressId changes', …)` testinden önce ekle:

```ts
  it('should set and clear the minimum order amount', async () => {
    const { service } = build();
    await service.create(7, dto({ minOrderKurus: 15000 }));

    expect((await service.update(7, { isPaused: true })).minOrderKurus).toBe(
      15000,
    );
    expect(
      (await service.update(7, { minOrderKurus: null })).minOrderKurus,
    ).toBeNull();
  });
```

Run: `npx jest src/kitchens/kitchens.service.spec.ts` → FAIL (`create` alanı yazmıyor: `minOrderKurus` `undefined`).

- [ ] **Step 5: Servis ve repository — kod**

`src/kitchens/kitchens.service.ts` — `create` içindeki nesnede `freeDeliveryMinKurus: dto.freeDeliveryMinKurus ?? null,` satırının altına:

```ts
        minOrderKurus: dto.minOrderKurus ?? null,
```

Aynı dosyada `findMine` metodundan önce:

```ts
  /** A live (not deleted) kitchen by id; customers' order quotes start here. */
  findById(id: Kitchen['id']): Promise<Kitchen | null> {
    return this.kitchenRepository.findById(id);
  }
```

`src/kitchens/infrastructure/persistence/kitchen.repository.ts` — `findByOwnerId` soyut metodunun altına:

```ts
  abstract findById(id: Kitchen['id']): Promise<NullableType<Kitchen>>;
```

`src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts` — `update` metodundan önce:

```ts
  async findById(id: Kitchen['id']): Promise<NullableType<Kitchen>> {
    const entity = await this.kitchenRepository.findOne({ where: { id } });
    return entity ? KitchenMapper.toDomain(entity) : null;
  }
```

(`update` `...changes` yayılımıyla alanı zaten taşır; `PATCH /kitchens/me` için ek kod gerekmez.)

Run: `npx jest src/kitchens` → PASS.

- [ ] **Step 6: Müşteri mutfak detayı — test ve kod**

`src/discovery/presenters.spec.ts` — `kitchen` fikstüründe `freeDeliveryMinKurus: 30000,` satırının altına `minOrderKurus: 15000,` ekle; `describe('kitchenDetail', …)` testindeki `toMatchObject` bloğunu şöyle yap:

```ts
    expect(detail).toMatchObject({
      description: 'Ev yemekleri',
      minOrderKurus: 15000,
      hours: kitchen.hours,
    });
```

Run: `npx jest src/discovery/presenters.spec.ts` → FAIL (`minOrderKurus` detayda yok).

`src/discovery/views.ts` — `KitchenDetail` sınıfında `description` alanının altına:

```ts
  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  minOrderKurus: number | null;
```

`src/discovery/presenters.ts` — `kitchenDetail` içindeki nesnede `description: kitchen.description,` satırının altına:

```ts
      minOrderKurus: kitchen.minOrderKurus,
```

Run: `npx jest src/discovery src/kitchens` → PASS.

- [ ] **Step 7: Migration**

```bash
npm run migration:generate -- src/database/migrations/KitchenMinOrder
npm run migration:run
```

Expected: tek ifade — `ALTER TABLE "kitchen" ADD "minOrderKurus" integer`. Başka ifade varsa DURUP kullanıcıya bildir.

- [ ] **Step 8: Elle doğrula**

```bash
TOKEN=$(curl -s localhost:3001/api/v1/auth/phone/login -H 'content-type: application/json' -d '{"idToken":"dev:+905550000101"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
curl -s -X PATCH localhost:3001/api/v1/kitchens/me -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"minOrderKurus":100001}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).errors'
curl -s -X PATCH localhost:3001/api/v1/kitchens/me -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"minOrderKurus":null}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.minOrderKurus'
```

Expected: önce `[ { field: 'minOrderKurus', message: 'minOrderKurus must not be greater than 100000' } ]`, sonra `null`.

- [ ] **Step 9: Commit**

```bash
npm test && npm run lint
git add src/kitchens src/discovery src/database/migrations
git commit -m "feat(kitchens): add an optional minimum order amount

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sipariş ve ödeme tabloları (`order`, `order_item`, `order_request`, `payment`)

**Files:**
- Generate: `src/orders/**`, `src/order-items/**`, `src/order-requests/**`, `src/payments/**`, `src/app.module.ts` (generator enjekte eder)
- Move (generator sonrası): `order-item.entity.ts` ve `order-request.entity.ts` → `src/orders/infrastructure/persistence/relational/entities/`
- Delete (generator sonrası): `src/order-items/`, `src/order-requests/`, `src/orders/dto/`, `src/orders/orders.controller.ts`, `src/orders/orders.service.ts`, `src/payments/dto/`, `src/payments/payments.controller.ts`, `src/payments/payments.service.ts`
- Create/Overwrite (son halleri aşağıda): `src/orders/domain/order.ts`, `src/orders/domain/order-item.ts`, `src/orders/infrastructure/persistence/relational/entities/{order,order-item,order-request}.entity.ts`, `src/orders/infrastructure/persistence/relational/mappers/{order,order-item}.mapper.ts`, `src/orders/infrastructure/persistence/order.repository.ts`, `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts`, `src/orders/infrastructure/persistence/relational/relational-persistence.module.ts`, `src/orders/orders.module.ts`, `src/payments/domain/payment.ts`, `src/payments/infrastructure/persistence/relational/entities/payment.entity.ts`, `src/payments/infrastructure/persistence/relational/mappers/payment.mapper.ts`, `src/payments/infrastructure/persistence/payment.repository.ts`, `src/payments/infrastructure/persistence/relational/repositories/payment.repository.ts`, `src/payments/infrastructure/persistence/relational/relational-persistence.module.ts`, `src/payments/payments.module.ts`
- Test: `src/orders/infrastructure/persistence/relational/mappers/order.mapper.spec.ts`
- Create (generate): `src/database/migrations/<timestamp>-CreateOrders.ts`

**Interfaces:**
- Consumes: Task 1 (`OrderStatus`, `Fulfillment`, `CancelledBy`, `OrderReason`, `CookTab`, `ACTIVE_STATUSES`, `COOK_TAB_STATUSES`, `generateOrderCode`), `SaleType`, `FileSnapshot`/`toSnapshot`/`toFileType`, `FileMapper`, `KitchenEntity`, `ProductEntity`, `UserEntity`, `EntityRelationalHelper`.
- Produces:
  - `type DeliveryAddress = { fullAddress; district; neighborhood; buildingNo: string | null; floor: string | null; apartmentNo: string | null; directions: string | null; latitude: number; longitude: number }`, `type PersonName = { firstName: string | null; lastName: string | null }`, `type OrderKitchen` (mutfak kartı + tam adres + `cook: PersonName & { photo }`), `class OrderItem { id; productId; position; name; unitPriceKurus; saleType; prepMinutes; photo: FileType | null; quantity; note }`, `class Order` (spec §2.2'nin tüm alanları + `items: OrderItem[]`, `kitchen: OrderKitchen`, `customer: PersonName`), `type NewOrderItem`, `type NewOrder`, `type OrderPatch`.
  - `class Payment { id; orderId; provider; providerRef; amountKurus; status: PaymentStatus; paidAt; refundedAt; createdAt; updatedAt }`, `enum PaymentStatus { paid, refunded, refundFailed = 'refund_failed', failed }`, `type NewPayment`.
  - `OrderRepository` (port): `place(input: { order: NewOrder; requestKey: string; portions: PortionTake[] }, charge: (order: Pick<Order, 'id' | 'totalKurus'>) => Promise<NewPayment>): Promise<Order>`, `findIdByRequestKey(customerId, key): Promise<NullableType<string>>`, `findById(id)`, `findForCustomer(customerId, id)`, `findForKitchen(kitchenId, id)`, `listForCustomer(customerId, statuses: OrderStatus[], page: OrderPage): Promise<Order[]>`, `listForKitchen(kitchenId, tab: CookTab, dayStart: Date, page: OrderPage): Promise<Order[]>`, `transition(id, from: OrderStatus[], patch: OrderPatch): Promise<NullableType<Order>>`, `closeAndRestock(id, from, patch): Promise<NullableType<Order>>`, `findOverduePendingIds(now: Date, scope: OverdueScope): Promise<string[]>`, `deleteRequestsBefore(cutoff: Date): Promise<void>`, `countByStatus(kitchenId, statuses): Promise<Partial<Record<OrderStatus, number>>>`, `completedTotals(kitchenId, since: Date): Promise<CompletedTotals>`, `hasCompleted(kitchenId): Promise<boolean>`, `hasActiveOrders(customerId, kitchenId: string | null): Promise<boolean>`, `clearDeliveryAddresses(customerId): Promise<void>`; tipler `PortionTake = { productId: string; quantity: number }`, `OrderPage = { offset: number; limit: number }`, `OverdueScope = { customerId?: User['id']; kitchenId?: Kitchen['id'] }`, `CompletedTotals = { orders: number; revenueKurus: number }`; hatalar `InsufficientPortionsError(productId)`, `DuplicateOrderRequestError`.
  - `PaymentRepository` (port): `findByOrderId(orderId: string): Promise<NullableType<Payment>>`, `update(id, payload: Partial<Pick<Payment, 'status' | 'refundedAt'>>): Promise<void>`.
  - `OrdersModule` (bu görevde yalnız persistence'ı dışa açar; Task 5'te genişler), `PaymentsModule` (yalnız persistence; Task 4'te genişler). `app.module.ts`'te `OrdersModule` ve `PaymentsModule` kayıtlı.

- [ ] **Step 1: Resource'ları ve alanları generator ile üret (sırayla)**

```bash
npm run generate:resource:relational -- --name Order
npm run generate:resource:relational -- --name OrderItem
npm run generate:resource:relational -- --name OrderRequest
npm run generate:resource:relational -- --name Payment

npm run add:property:to-relational -- --name Order --property code --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property customer --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Order --property kitchen --kind reference --type Kitchen --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Order --property status --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property fulfillment --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property deliveryAddress --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property distanceKm --kind primitive --type number --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property note --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property subtotalKurus --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property deliveryFeeKurus --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property serviceFeeKurus --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property totalKurus --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property pickupCode --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property expiresAt --kind primitive --type Date --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property estimatedReadyAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property acceptedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property preparingAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property readyAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property onTheWayAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property completedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property closedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property cancelledBy --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property reason --kind primitive --type string --isAddToDto false --isOptional true --isNullable true

npm run add:property:to-relational -- --name OrderItem --property order --kind reference --type Order --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderItem --property product --kind reference --type Product --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderItem --property position --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderItem --property name --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderItem --property unitPriceKurus --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderItem --property saleType --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderItem --property prepMinutes --kind primitive --type number --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name OrderItem --property photo --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name OrderItem --property quantity --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderItem --property note --kind primitive --type string --isAddToDto false --isOptional true --isNullable true

npm run add:property:to-relational -- --name OrderRequest --property key --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderRequest --property customer --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderRequest --property order --kind reference --type Order --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false

npm run add:property:to-relational -- --name Payment --property order --kind reference --type Order --referenceType oneToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Payment --property provider --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Payment --property providerRef --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Payment --property amountKurus --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Payment --property status --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Payment --property paidAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Payment --property refundedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
```

(`deliveryAddress` ve `photo` string olarak üretilir, Step 3'te jsonb yapılır. `order_item → order` ilişkisi skill kuralı gereği çocuk tarafta `manyToOne` üretilir; `Order.items` ters ilişkisi Step 3'te elle eklenir.)

Kontrol: `git status` → `src/orders/`, `src/order-items/`, `src/order-requests/`, `src/payments/` yeni; `src/app.module.ts`'te `OrdersModule`, `OrderItemsModule`, `OrderRequestsModule`, `PaymentsModule`. Generator'ın oluşturduğu dosya adları **Files** listesiyle eşleşmiyorsa DURUP kullanıcıya bildir.

- [ ] **Step 2: `order_item` ve `order_request` siparişe taşınır, gereksiz iskelet silinir**

`order_item` ve `order_request` yalnız sipariş modülünün okuyup yazdığı tablolardır; ayrı modül, controller ve CRUD servisi gerekmez.

```bash
mv src/order-items/infrastructure/persistence/relational/entities/order-item.entity.ts src/orders/infrastructure/persistence/relational/entities/
mv src/order-requests/infrastructure/persistence/relational/entities/order-request.entity.ts src/orders/infrastructure/persistence/relational/entities/
rm -rf src/order-items src/order-requests
rm -rf src/orders/dto src/orders/orders.controller.ts src/orders/orders.service.ts
rm -rf src/payments/dto src/payments/payments.controller.ts src/payments/payments.service.ts
```

`src/app.module.ts` — generator'ın eklediği `import { OrderItemsModule } …` ve `import { OrderRequestsModule } …` satırlarını ve `imports` dizisindeki `OrderItemsModule,` ile `OrderRequestsModule,` girdilerini sil. `OrdersModule` ve `PaymentsModule` kalır.

- [ ] **Step 3: Domain ve entity'ler**

`src/orders/domain/order-item.ts`:

```ts
import { SaleType } from '../../catalog/catalog.enums';
import { FileType } from '../../files/domain/file';

/** A line of an order: a copy of the product as it was when ordered. */
export class OrderItem {
  id: string;

  productId: string;

  /** Cart order, from 0. */
  position: number;

  name: string;

  unitPriceKurus: number;

  saleType: SaleType;

  prepMinutes: number | null;

  /** The product's first photo at order time. */
  photo: FileType | null;

  quantity: number;

  note: string | null;
}
```

`src/orders/domain/order.ts` — dosyanın tamamı (domain yanıt olarak dönmez, Swagger sınıfları Task 5'teki `views.ts`'te):

```ts
import { FileType } from '../../files/domain/file';
import { Kitchen } from '../../kitchens/domain/kitchen';
import { User } from '../../users/domain/user';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from '../order.enums';
import { OrderItem } from './order-item';

/** A copy of the address-book entry; kept when the entry is deleted. */
export type DeliveryAddress = {
  fullAddress: string;
  district: string;
  neighborhood: string;
  buildingNo: string | null;
  floor: string | null;
  apartmentNo: string | null;
  directions: string | null;
  latitude: number;
  longitude: number;
};

export type PersonName = { firstName: string | null; lastName: string | null };

/** The kitchen side, read with every order (soft-deleted kitchens included). */
export type OrderKitchen = Pick<
  Kitchen,
  | 'id'
  | 'ownerId'
  | 'name'
  | 'coverPhoto'
  | 'district'
  | 'fullAddress'
  | 'latitude'
  | 'longitude'
> & { cook: PersonName & { photo: FileType | null } };

export class Order {
  id: string;

  /** `S-7K3F` */
  code: string;

  customerId: User['id'];

  kitchenId: Kitchen['id'];

  status: OrderStatus;

  fulfillment: Fulfillment;

  /** Delivery only; cleared when the customer deletes the account. */
  deliveryAddress: DeliveryAddress | null;

  distanceKm: number | null;

  note: string | null;

  subtotalKurus: number;

  deliveryFeeKurus: number;

  serviceFeeKurus: number;

  totalKurus: number;

  /** Pickup only; never shown to the cook. */
  pickupCode: string | null;

  expiresAt: Date;

  estimatedReadyAt: Date | null;

  acceptedAt: Date | null;

  preparingAt: Date | null;

  readyAt: Date | null;

  onTheWayAt: Date | null;

  completedAt: Date | null;

  /** Rejected, cancelled or expired. */
  closedAt: Date | null;

  cancelledBy: CancelledBy | null;

  reason: OrderReason | null;

  /** In cart order. */
  items: OrderItem[];

  kitchen: OrderKitchen;

  customer: PersonName;

  createdAt: Date;

  updatedAt: Date;
}

export type NewOrderItem = Omit<OrderItem, 'id'>;

/** What OrderRepository.place inserts; the repository picks the code. */
export type NewOrder = Omit<
  Order,
  'id' | 'code' | 'items' | 'kitchen' | 'customer' | 'createdAt' | 'updatedAt'
> & { items: NewOrderItem[] };

/** What a status change may write. */
export type OrderPatch = Partial<
  Pick<
    Order,
    | 'status'
    | 'estimatedReadyAt'
    | 'acceptedAt'
    | 'preparingAt'
    | 'readyAt'
    | 'onTheWayAt'
    | 'completedAt'
    | 'closedAt'
    | 'cancelledBy'
    | 'reason'
  >
>;
```

`src/orders/infrastructure/persistence/relational/entities/order.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { DeliveryAddress } from '../../../../domain/order';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from '../../../../order.enums';
import { OrderItemEntity } from './order-item.entity';

@Entity({
  name: 'order',
})
@Index(['kitchenId', 'status'])
@Index(['customerId', 'status'])
export class OrderEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 6, unique: true })
  code: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'customerId' })
  customer?: UserEntity;

  @Column({ type: Number })
  customerId: number;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Column({ type: 'uuid' })
  kitchenId: string;

  @Column({ type: String })
  status: OrderStatus;

  @Column({ type: String })
  fulfillment: Fulfillment;

  @Column({ type: 'jsonb', nullable: true })
  deliveryAddress: DeliveryAddress | null;

  @Column({ type: 'double precision', nullable: true })
  distanceKm: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: Number })
  subtotalKurus: number;

  @Column({ type: Number })
  deliveryFeeKurus: number;

  @Column({ type: Number })
  serviceFeeKurus: number;

  @Column({ type: Number })
  totalKurus: number;

  @Column({ type: 'char', length: 4, nullable: true })
  pickupCode: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  estimatedReadyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  preparingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  onTheWayAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: String, nullable: true })
  cancelledBy: CancelledBy | null;

  @Column({ type: String, nullable: true })
  reason: OrderReason | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: OrderItemEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

`src/orders/infrastructure/persistence/relational/entities/order-item.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SaleType } from '../../../../../catalog/catalog.enums';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { ProductEntity } from '../../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderEntity } from './order.entity';

@Entity({
  name: 'order_item',
})
export class OrderItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Index()
  @Column({ type: 'uuid' })
  orderId: string;

  // Products are only soft-deleted, so the link survives menu changes.
  @ManyToOne(() => ProductEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'productId' })
  product?: ProductEntity;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: Number })
  position: number;

  @Column({ type: String })
  name: string;

  @Column({ type: Number })
  unitPriceKurus: number;

  @Column({ type: String })
  saleType: SaleType;

  @Column({ type: Number, nullable: true })
  prepMinutes: number | null;

  @Column({ type: 'jsonb', nullable: true })
  photo: FileSnapshot | null;

  @Column({ type: Number })
  quantity: number;

  @Column({ type: 'varchar', length: 140, nullable: true })
  note: string | null;
}
```

`src/orders/infrastructure/persistence/relational/entities/order-request.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderEntity } from './order.entity';

/** Idempotency-Key of POST /orders → the order it created; swept after 24 h. */
@Entity({
  name: 'order_request',
})
@Unique(['customerId', 'key'])
export class OrderRequestEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  key: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'customerId' })
  customer?: UserEntity;

  @Column({ type: Number })
  customerId: number;

  @ManyToOne(() => OrderEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

`src/payments/domain/payment.ts` — dosyanın tamamı:

```ts
export enum PaymentStatus {
  paid = 'paid',
  refunded = 'refunded',
  refundFailed = 'refund_failed',
  /** Reserved for asynchronous providers; a declined charge rolls the order back and stores nothing. */
  failed = 'failed',
}

/** One per order: the charge taken when it was placed and, later, its refund. */
export class Payment {
  id: string;

  orderId: string;

  /** `dev` until a real provider exists (Faz 5). */
  provider: string;

  providerRef: string;

  amountKurus: number;

  status: PaymentStatus;

  paidAt: Date | null;

  refundedAt: Date | null;

  createdAt: Date;

  updatedAt: Date;
}

export type NewPayment = Omit<Payment, 'id' | 'createdAt' | 'updatedAt'>;
```

`src/payments/infrastructure/persistence/relational/entities/payment.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { PaymentStatus } from '../../../../domain/payment';

@Entity({
  name: 'payment',
})
export class PaymentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One payment per order: the one-to-one join column is unique.
  @OneToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: String })
  provider: string;

  @Column({ type: String })
  providerRef: string;

  @Column({ type: Number })
  amountKurus: number;

  @Column({ type: String })
  status: PaymentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **Step 4: Mapper — test**

`src/orders/infrastructure/persistence/relational/mappers/order.mapper.spec.ts`:

```ts
import { SaleType } from '../../../../../catalog/catalog.enums';
import { FileType } from '../../../../../files/domain/file';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { Fulfillment, OrderStatus } from '../../../../order.enums';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemMapper } from './order-item.mapper';
import { OrderMapper } from './order.mapper';

const item = (position: number, name: string) =>
  Object.assign(new OrderItemEntity(), {
    id: `i${position}`,
    orderId: 'o1',
    productId: `p${position}`,
    position,
    name,
    unitPriceKurus: 14000,
    saleType: SaleType.onDemand,
    prepMinutes: 45,
    photo: position === 0 ? { id: 'f1', path: '/f1.png' } : null,
    quantity: 1,
    note: null,
  });

const entity = (): OrderEntity =>
  Object.assign(new OrderEntity(), {
    id: 'o1',
    code: 'S-7K3F',
    customerId: 9,
    kitchenId: 'k1',
    status: OrderStatus.pending,
    fulfillment: Fulfillment.pickup,
    deliveryAddress: null,
    distanceKm: null,
    note: 'Kapıda arayın',
    subtotalKurus: 28000,
    deliveryFeeKurus: 0,
    serviceFeeKurus: 1400,
    totalKurus: 29400,
    pickupCode: '0427',
    items: [item(1, 'Sütlaç'), item(0, 'Mantı')],
    kitchen: Object.assign(new KitchenEntity(), {
      id: 'k1',
      ownerId: 7,
      name: 'Ayşe Teyze Mutfağı',
      coverPhoto: { id: 'c1', path: '/c1.png' },
      district: 'Kadıköy',
      fullAddress: 'Caferağa Mh. Moda Cd. No:10',
      latitude: 40.9862,
      longitude: 29.0254,
      owner: Object.assign(new UserEntity(), {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        photo: Object.assign(new FileEntity(), { id: 'u1', path: '/u1.png' }),
      }),
    }),
    customer: Object.assign(new UserEntity(), {
      firstName: 'Deniz',
      lastName: 'Arslan',
    }),
  });

describe('OrderMapper.toDomain', () => {
  it('should keep cart order and turn snapshots into files', () => {
    const order = OrderMapper.toDomain(entity());

    expect(order.items.map((i) => i.name)).toEqual(['Mantı', 'Sütlaç']);
    expect(order.items[0].photo).toBeInstanceOf(FileType);
    expect(order.items[1].photo).toBeNull();
    expect(order.kitchen.coverPhoto).toBeInstanceOf(FileType);
  });

  it('should carry the kitchen card, the cook and the customer names', () => {
    expect(OrderMapper.toDomain(entity())).toMatchObject({
      code: 'S-7K3F',
      pickupCode: '0427',
      kitchen: {
        id: 'k1',
        ownerId: 7,
        district: 'Kadıköy',
        cook: { firstName: 'Ayşe', lastName: 'Yılmaz', photo: { id: 'u1' } },
      },
      customer: { firstName: 'Deniz', lastName: 'Arslan' },
    });
  });

  it('should tolerate an anonymized customer and a cook without a photo', () => {
    const raw = entity();
    (raw.kitchen as KitchenEntity).owner = Object.assign(new UserEntity(), {
      firstName: null,
      lastName: null,
      photo: null,
    });
    raw.customer = Object.assign(new UserEntity(), {
      firstName: null,
      lastName: null,
    });

    expect(OrderMapper.toDomain(raw)).toMatchObject({
      kitchen: { cook: { firstName: null, photo: null } },
      customer: { firstName: null, lastName: null },
    });
  });
});

describe('OrderItemMapper.toPersistence', () => {
  it('should snapshot the photo and attach the order', () => {
    const row = OrderItemMapper.toPersistence(
      {
        productId: 'p1',
        position: 0,
        name: 'Mantı',
        unitPriceKurus: 14000,
        saleType: SaleType.onDemand,
        prepMinutes: 45,
        photo: Object.assign(new FileType(), { id: 'f1', path: '/f1.png' }),
        quantity: 2,
        note: 'Az acılı',
      },
      'o1',
    );

    expect(row).toMatchObject({
      orderId: 'o1',
      photo: { id: 'f1', path: '/f1.png' },
      quantity: 2,
    });
    expect(row.photo).not.toBeInstanceOf(FileType);
  });
});
```

Run: `npx jest src/orders/infrastructure` → FAIL (mapper'lar generator iskeleti; `items`/`kitchen` eşlenmiyor ya da `order-item.mapper` yok).

- [ ] **Step 5: Mapper'lar — kod**

`src/orders/infrastructure/persistence/relational/mappers/order-item.mapper.ts`:

```ts
import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { NewOrderItem } from '../../../../domain/order';
import { OrderItem } from '../../../../domain/order-item';
import { OrderItemEntity } from '../entities/order-item.entity';

export class OrderItemMapper {
  static toDomain(raw: OrderItemEntity): OrderItem {
    return Object.assign(new OrderItem(), {
      id: raw.id,
      productId: raw.productId,
      position: raw.position,
      name: raw.name,
      unitPriceKurus: raw.unitPriceKurus,
      saleType: raw.saleType,
      prepMinutes: raw.prepMinutes,
      photo: raw.photo ? toFileType(raw.photo) : null,
      quantity: raw.quantity,
      note: raw.note,
    });
  }

  static toPersistence(item: NewOrderItem, orderId: string): OrderItemEntity {
    return Object.assign(new OrderItemEntity(), {
      ...item,
      orderId,
      photo: item.photo ? toSnapshot(item.photo) : null,
    });
  }
}
```

`src/orders/infrastructure/persistence/relational/mappers/order.mapper.ts` — dosyanın tamamı:

```ts
import { toFileType } from '../../../../../catalog/file-snapshot';
import { FileMapper } from '../../../../../files/infrastructure/persistence/relational/mappers/file.mapper';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { NewOrder, Order } from '../../../../domain/order';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemMapper } from './order-item.mapper';

export class OrderMapper {
  /** Expects items, kitchen (+ owner) and customer joined — OrderRelationalRepository always does. */
  static toDomain(raw: OrderEntity): Order {
    const kitchen = raw.kitchen as KitchenEntity;
    const cook = kitchen.owner;

    return Object.assign(new Order(), {
      id: raw.id,
      code: raw.code,
      customerId: raw.customerId,
      kitchenId: raw.kitchenId,
      status: raw.status,
      fulfillment: raw.fulfillment,
      deliveryAddress: raw.deliveryAddress,
      distanceKm: raw.distanceKm,
      note: raw.note,
      subtotalKurus: raw.subtotalKurus,
      deliveryFeeKurus: raw.deliveryFeeKurus,
      serviceFeeKurus: raw.serviceFeeKurus,
      totalKurus: raw.totalKurus,
      pickupCode: raw.pickupCode,
      expiresAt: raw.expiresAt,
      estimatedReadyAt: raw.estimatedReadyAt,
      acceptedAt: raw.acceptedAt,
      preparingAt: raw.preparingAt,
      readyAt: raw.readyAt,
      onTheWayAt: raw.onTheWayAt,
      completedAt: raw.completedAt,
      closedAt: raw.closedAt,
      cancelledBy: raw.cancelledBy,
      reason: raw.reason,
      items: (raw.items ?? [])
        .map((item) => OrderItemMapper.toDomain(item))
        .sort((a, b) => a.position - b.position),
      kitchen: {
        id: kitchen.id,
        ownerId: kitchen.ownerId,
        name: kitchen.name,
        coverPhoto: kitchen.coverPhoto ? toFileType(kitchen.coverPhoto) : null,
        district: kitchen.district,
        fullAddress: kitchen.fullAddress,
        latitude: kitchen.latitude,
        longitude: kitchen.longitude,
        cook: {
          firstName: cook?.firstName ?? null,
          lastName: cook?.lastName ?? null,
          photo: cook?.photo ? FileMapper.toDomain(cook.photo) : null,
        },
      },
      customer: {
        firstName: raw.customer?.firstName ?? null,
        lastName: raw.customer?.lastName ?? null,
      },
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  /** The order row; items are inserted separately. */
  static toPersistence(order: Omit<NewOrder, 'items'>): OrderEntity {
    return Object.assign(new OrderEntity(), order, {
      customerId: Number(order.customerId),
    });
  }
}
```

`src/payments/infrastructure/persistence/relational/mappers/payment.mapper.ts` — dosyanın tamamı:

```ts
import { NewPayment, Payment } from '../../../../domain/payment';
import { PaymentEntity } from '../entities/payment.entity';

export class PaymentMapper {
  static toDomain(raw: PaymentEntity): Payment {
    return Object.assign(new Payment(), {
      id: raw.id,
      orderId: raw.orderId,
      provider: raw.provider,
      providerRef: raw.providerRef,
      amountKurus: raw.amountKurus,
      status: raw.status,
      paidAt: raw.paidAt,
      refundedAt: raw.refundedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static toPersistence(domain: Partial<NewPayment>): PaymentEntity {
    return Object.assign(new PaymentEntity(), domain);
  }
}
```

Run: `npx jest src/orders/infrastructure` → PASS (4 test).

- [ ] **Step 6: Repository'ler**

`src/orders/infrastructure/persistence/order.repository.ts` — dosyanın tamamı:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../payments/domain/payment';
import { User } from '../../../users/domain/user';
import { NullableType } from '../../../utils/types/nullable.type';
import { NewOrder, Order, OrderPatch } from '../../domain/order';
import { CookTab, OrderStatus } from '../../order.enums';

/** A daily-portion product and how many portions the order takes. */
export type PortionTake = { productId: string; quantity: number };

export type OrderPage = { offset: number; limit: number };

export type OverdueScope = {
  customerId?: User['id'];
  kitchenId?: Kitchen['id'];
};

export type CompletedTotals = { orders: number; revenueKurus: number };

/** Someone took the last portions between the quote and the order. */
export class InsufficientPortionsError extends Error {
  constructor(readonly productId: string) {
    super(`Not enough portions left of product ${productId}`);
  }
}

/** The same Idempotency-Key was used concurrently; the other request won. */
export class DuplicateOrderRequestError extends Error {}

export abstract class OrderRepository {
  /**
   * One transaction: insert the order (with a fresh code), its items and the
   * request key, take the daily portions, call `charge`, store the payment it
   * returns. Anything thrown — InsufficientPortionsError,
   * DuplicateOrderRequestError or the charge's own error — rolls it all back.
   */
  abstract place(
    input: { order: NewOrder; requestKey: string; portions: PortionTake[] },
    charge: (order: Pick<Order, 'id' | 'totalKurus'>) => Promise<NewPayment>,
  ): Promise<Order>;

  abstract findIdByRequestKey(
    customerId: User['id'],
    key: string,
  ): Promise<NullableType<Order['id']>>;

  abstract findById(id: Order['id']): Promise<NullableType<Order>>;

  abstract findForCustomer(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>>;

  abstract findForKitchen(
    kitchenId: Kitchen['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>>;

  /** Newest first. */
  abstract listForCustomer(
    customerId: User['id'],
    statuses: OrderStatus[],
    page: OrderPage,
  ): Promise<Order[]>;

  /** Oldest first; `done` is today's closed orders (since `dayStart`), newest first. */
  abstract listForKitchen(
    kitchenId: Kitchen['id'],
    tab: CookTab,
    dayStart: Date,
    page: OrderPage,
  ): Promise<Order[]>;

  /**
   * `UPDATE … WHERE id = :id AND status IN (:from)`; null when no row matched
   * (someone else moved the order first).
   */
  abstract transition(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>>;

  /** transition() and, in the same transaction, the daily portions go back on sale. */
  abstract closeAndRestock(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>>;

  /** Pending orders whose answer time ran out, oldest first. */
  abstract findOverduePendingIds(
    now: Date,
    scope: OverdueScope,
  ): Promise<Order['id'][]>;

  abstract deleteRequestsBefore(cutoff: Date): Promise<void>;

  abstract countByStatus(
    kitchenId: Kitchen['id'],
    statuses: OrderStatus[],
  ): Promise<Partial<Record<OrderStatus, number>>>;

  /** Orders completed since `since`; revenue is the subtotal (fees are not the cook's). */
  abstract completedTotals(
    kitchenId: Kitchen['id'],
    since: Date,
  ): Promise<CompletedTotals>;

  abstract hasCompleted(kitchenId: Kitchen['id']): Promise<boolean>;

  /** As the customer, or as the cook of `kitchenId`. */
  abstract hasActiveOrders(
    customerId: User['id'],
    kitchenId: Kitchen['id'] | null,
  ): Promise<boolean>;

  /** Account deletion (KVKK): the copies of the customer's addresses go. */
  abstract clearDeliveryAddresses(customerId: User['id']): Promise<void>;
}
```

`src/orders/infrastructure/persistence/relational/repositories/order.repository.ts` — dosyanın tamamı. Notlar: sipariş satırı `INSERT … ON CONFLICT DO NOTHING RETURNING "id"` ile eklenir, kod çakışırsa yeni kodla tekrar denenir (transaction düşmez); porsiyon düşümü `"portionsAvailable" >= :quantity` koşullu UPDATE, etkilenen satır 0 → `InsufficientPortionsError`; aynı `Idempotency-Key`'le eşzamanlı ikinci istek `order_request` unique ihlaliyle ödemeden **önce** düşer; listeler önce sayfalanmış id'leri ham sorguyla alır, sonra ilişkileriyle yükler (sıralama ifadesi ve sayfalama ilişki join'leriyle karışmasın diye).

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  FindOptionsWhere,
  In,
  LessThan,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { SaleType } from '../../../../../catalog/catalog.enums';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../../../payments/domain/payment';
import { PaymentEntity } from '../../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
import { PaymentMapper } from '../../../../../payments/infrastructure/persistence/relational/mappers/payment.mapper';
import { ProductEntity } from '../../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { User } from '../../../../../users/domain/user';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { NewOrder, Order, OrderPatch } from '../../../../domain/order';
import { generateOrderCode } from '../../../../order-codes';
import { ACTIVE_STATUSES, COOK_TAB_STATUSES } from '../../../../order-status';
import { CookTab, OrderStatus } from '../../../../order.enums';
import {
  CompletedTotals,
  DuplicateOrderRequestError,
  InsufficientPortionsError,
  OrderPage,
  OrderRepository,
  OverdueScope,
  PortionTake,
} from '../../order.repository';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRequestEntity } from '../entities/order-request.entity';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemMapper } from '../mappers/order-item.mapper';
import { OrderMapper } from '../mappers/order.mapper';

/** Everything OrderMapper.toDomain reads; soft-deleted kitchens and users included. */
const RELATIONS: FindOptionsRelations<OrderEntity> = {
  items: true,
  kitchen: { owner: { photo: true } },
  customer: true,
};

const CODE_ATTEMPTS = 10;

const isUniqueViolation = (error: unknown, table: string): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string; table?: string }).code === '23505' &&
  (error.driverError as { table?: string }).table === table;

@Injectable()
export class OrderRelationalRepository implements OrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderRequestEntity)
    private readonly requests: Repository<OrderRequestEntity>,
  ) {}

  async place(
    input: { order: NewOrder; requestKey: string; portions: PortionTake[] },
    charge: (order: Pick<Order, 'id' | 'totalKurus'>) => Promise<NewPayment>,
  ): Promise<Order> {
    const { items, ...row } = input.order;
    let orderId: string;

    try {
      orderId = await this.orders.manager.transaction(async (manager) => {
        const id = await this.insertWithFreshCode(manager, row);

        await manager.insert(
          OrderItemEntity,
          items.map((item) => OrderItemMapper.toPersistence(item, id)),
        );
        // A concurrent request with the same key blocks here until the first
        // commits, then fails with a unique violation — before any charge.
        await manager.insert(OrderRequestEntity, {
          key: input.requestKey,
          customerId: Number(row.customerId),
          orderId: id,
        });

        // Same product order in every transaction: no lock-order deadlocks.
        const portions = [...input.portions].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        );

        for (const take of portions) {
          const { affected } = await manager
            .createQueryBuilder()
            .update(ProductEntity)
            .set({ portionsAvailable: () => '"portionsAvailable" - :quantity' })
            .where('id = :productId')
            .andWhere('"deletedAt" IS NULL')
            .andWhere('"isActive" = true')
            .andWhere('"saleType" = :saleType')
            .andWhere('"portionsAvailable" >= :quantity')
            .setParameters({
              productId: take.productId,
              quantity: take.quantity,
              saleType: SaleType.dailyPortion,
            })
            .execute();

          if (!affected) {
            throw new InsufficientPortionsError(take.productId);
          }
        }

        const payment = await charge({ id, totalKurus: row.totalKurus });
        await manager.insert(
          PaymentEntity,
          PaymentMapper.toPersistence(payment),
        );

        return id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'order_request')) {
        throw new DuplicateOrderRequestError();
      }

      throw error;
    }

    return this.findByIdOrFail(orderId);
  }

  async findIdByRequestKey(
    customerId: User['id'],
    key: string,
  ): Promise<NullableType<Order['id']>> {
    const request = await this.requests.findOne({
      where: { customerId: Number(customerId), key },
    });
    return request?.orderId ?? null;
  }

  findById(id: Order['id']): Promise<NullableType<Order>> {
    return this.findOneWhere({ id });
  }

  findForCustomer(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>> {
    return this.findOneWhere({ id, customerId: Number(customerId) });
  }

  findForKitchen(
    kitchenId: Kitchen['id'],
    id: Order['id'],
  ): Promise<NullableType<Order>> {
    return this.findOneWhere({ id, kitchenId });
  }

  async listForCustomer(
    customerId: User['id'],
    statuses: OrderStatus[],
    page: OrderPage,
  ): Promise<Order[]> {
    const rows = await this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o."customerId" = :customerId', {
        customerId: Number(customerId),
      })
      .andWhere('o.status IN (:...statuses)', { statuses })
      .orderBy('o.createdAt', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .offset(page.offset)
      .limit(page.limit)
      .getRawMany<{ id: string }>();

    return this.findManyInOrder(rows.map((row) => row.id));
  }

  async listForKitchen(
    kitchenId: Kitchen['id'],
    tab: CookTab,
    dayStart: Date,
    page: OrderPage,
  ): Promise<Order[]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: COOK_TAB_STATUSES[tab],
      });

    if (tab === CookTab.done) {
      qb.andWhere('COALESCE(o."completedAt", o."closedAt") >= :dayStart', {
        dayStart,
      }).orderBy('COALESCE(o."completedAt", o."closedAt")', 'DESC');
    } else {
      qb.orderBy('o.createdAt', 'ASC');
    }

    const rows = await qb
      .addOrderBy('o.id', 'ASC')
      .offset(page.offset)
      .limit(page.limit)
      .getRawMany<{ id: string }>();

    return this.findManyInOrder(rows.map((row) => row.id));
  }

  async transition(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>> {
    const { affected } = await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set(patch)
      .where('id = :id', { id })
      .andWhere('status IN (:...from)', { from })
      .execute();

    return affected ? this.findById(id) : null;
  }

  async closeAndRestock(
    id: Order['id'],
    from: OrderStatus[],
    patch: OrderPatch,
  ): Promise<NullableType<Order>> {
    const closed = await this.orders.manager.transaction(async (manager) => {
      const { affected } = await manager
        .createQueryBuilder()
        .update(OrderEntity)
        .set(patch)
        .where('id = :id', { id })
        .andWhere('status IN (:...from)', { from })
        .execute();

      if (!affected) {
        return false;
      }

      const items = await manager.find(OrderItemEntity, {
        where: { orderId: id, saleType: SaleType.dailyPortion },
        order: { productId: 'ASC' },
      });

      // A deleted product, or one switched to on-demand since, is skipped.
      for (const item of items) {
        await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ portionsAvailable: () => '"portionsAvailable" + :quantity' })
          .where('id = :productId')
          .andWhere('"deletedAt" IS NULL')
          .andWhere('"saleType" = :saleType')
          .setParameters({
            productId: item.productId,
            quantity: item.quantity,
            saleType: SaleType.dailyPortion,
          })
          .execute();
      }

      return true;
    });

    return closed ? this.findById(id) : null;
  }

  async findOverduePendingIds(
    now: Date,
    scope: OverdueScope,
  ): Promise<Order['id'][]> {
    const qb = this.orders
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where('o.status = :pending', { pending: OrderStatus.pending })
      .andWhere('o."expiresAt" < :now', { now });

    if (scope.customerId !== undefined) {
      qb.andWhere('o."customerId" = :customerId', {
        customerId: Number(scope.customerId),
      });
    }

    if (scope.kitchenId !== undefined) {
      qb.andWhere('o."kitchenId" = :kitchenId', { kitchenId: scope.kitchenId });
    }

    const rows = await qb
      .orderBy('o.expiresAt', 'ASC')
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async deleteRequestsBefore(cutoff: Date): Promise<void> {
    await this.requests.delete({ createdAt: LessThan(cutoff) });
  }

  async countByStatus(
    kitchenId: Kitchen['id'],
    statuses: OrderStatus[],
  ): Promise<Partial<Record<OrderStatus, number>>> {
    const rows = await this.orders
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere('o.status IN (:...statuses)', { statuses })
      .groupBy('o.status')
      .getRawMany<{ status: OrderStatus; count: string }>();

    return Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    );
  }

  async completedTotals(
    kitchenId: Kitchen['id'],
    since: Date,
  ): Promise<CompletedTotals> {
    const row = await this.orders
      .createQueryBuilder('o')
      .select('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(o."subtotalKurus"), 0)', 'revenue')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere('o.status = :completed', { completed: OrderStatus.completed })
      .andWhere('o."completedAt" >= :since', { since })
      .getRawOne<{ orders: string; revenue: string }>();

    return {
      orders: Number(row?.orders ?? 0),
      revenueKurus: Number(row?.revenue ?? 0),
    };
  }

  hasCompleted(kitchenId: Kitchen['id']): Promise<boolean> {
    return this.orders.exists({
      where: { kitchenId, status: OrderStatus.completed },
    });
  }

  hasActiveOrders(
    customerId: User['id'],
    kitchenId: Kitchen['id'] | null,
  ): Promise<boolean> {
    const where: FindOptionsWhere<OrderEntity>[] = [
      { customerId: Number(customerId), status: In(ACTIVE_STATUSES) },
    ];

    if (kitchenId) {
      where.push({ kitchenId, status: In(ACTIVE_STATUSES) });
    }

    return this.orders.exists({ where });
  }

  async clearDeliveryAddresses(customerId: User['id']): Promise<void> {
    await this.orders
      .createQueryBuilder()
      .update(OrderEntity)
      .set({ deliveryAddress: () => 'NULL' })
      .where('"customerId" = :customerId', { customerId: Number(customerId) })
      .andWhere('"deliveryAddress" IS NOT NULL')
      .execute();
  }

  /** ON CONFLICT DO NOTHING + retry: a code collision never aborts the transaction. */
  private async insertWithFreshCode(
    manager: EntityManager,
    row: Omit<NewOrder, 'items'>,
  ): Promise<string> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(OrderEntity)
        .values({
          ...OrderMapper.toPersistence(row),
          code: generateOrderCode(),
        })
        .orIgnore()
        .returning(['id'])
        .updateEntity(false)
        .execute();
      const [inserted] = result.raw as { id: string }[];

      if (inserted) {
        return inserted.id;
      }
    }

    throw new Error(`No free order code after ${CODE_ATTEMPTS} attempts`);
  }

  private async findOneWhere(
    where: FindOptionsWhere<OrderEntity>,
  ): Promise<NullableType<Order>> {
    const entity = await this.orders.findOne({
      where,
      relations: RELATIONS,
      withDeleted: true,
    });
    return entity ? OrderMapper.toDomain(entity) : null;
  }

  private async findByIdOrFail(id: Order['id']): Promise<Order> {
    const entity = await this.orders.findOneOrFail({
      where: { id },
      relations: RELATIONS,
      withDeleted: true,
    });
    return OrderMapper.toDomain(entity);
  }

  /** Loads with relations and keeps the order of `ids` (a page from a raw query). */
  private async findManyInOrder(ids: Order['id'][]): Promise<Order[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.orders.find({
      where: { id: In(ids) },
      relations: RELATIONS,
      withDeleted: true,
    });
    const byId = new Map(entities.map((entity) => [entity.id, entity]));

    return ids.flatMap((id) => {
      const entity = byId.get(id);
      return entity ? [OrderMapper.toDomain(entity)] : [];
    });
  }
}
```

`src/orders/infrastructure/persistence/relational/relational-persistence.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderRepository } from '../order.repository';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderRequestEntity } from './entities/order-request.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderRelationalRepository } from './repositories/order.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderItemEntity,
      OrderRequestEntity,
    ]),
  ],
  providers: [
    {
      provide: OrderRepository,
      useClass: OrderRelationalRepository,
    },
  ],
  exports: [OrderRepository],
})
export class RelationalOrderPersistenceModule {}
```

`src/payments/infrastructure/persistence/payment.repository.ts` — dosyanın tamamı:

```ts
import { NullableType } from '../../../utils/types/nullable.type';
import { Payment } from '../../domain/payment';

/** Payments are created with their order (OrderRepository.place). */
export abstract class PaymentRepository {
  abstract findByOrderId(orderId: string): Promise<NullableType<Payment>>;

  abstract update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt'>>,
  ): Promise<void>;
}
```

`src/payments/infrastructure/persistence/relational/repositories/payment.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Payment } from '../../../../domain/payment';
import { PaymentRepository } from '../../payment.repository';
import { PaymentEntity } from '../entities/payment.entity';
import { PaymentMapper } from '../mappers/payment.mapper';

@Injectable()
export class PaymentRelationalRepository implements PaymentRepository {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
  ) {}

  async findByOrderId(orderId: string): Promise<NullableType<Payment>> {
    const entity = await this.paymentRepository.findOne({ where: { orderId } });
    return entity ? PaymentMapper.toDomain(entity) : null;
  }

  async update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt'>>,
  ): Promise<void> {
    await this.paymentRepository.update({ id }, payload);
  }
}
```

`src/payments/infrastructure/persistence/relational/relational-persistence.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { PaymentRepository } from '../payment.repository';
import { PaymentRelationalRepository } from './repositories/payment.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentEntity } from './entities/payment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity])],
  providers: [
    {
      provide: PaymentRepository,
      useClass: PaymentRelationalRepository,
    },
  ],
  exports: [PaymentRepository],
})
export class RelationalPaymentPersistenceModule {}
```

- [ ] **Step 7: Modüller (şimdilik yalnız persistence)**

`src/orders/orders.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderPersistenceModule,
  ],
  exports: [RelationalOrderPersistenceModule],
})
export class OrdersModule {}
```

`src/payments/payments.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalPaymentPersistenceModule,
  ],
  exports: [RelationalPaymentPersistenceModule],
})
export class PaymentsModule {}
```

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: hata yok. (Dev API watch modunda yeniden başlar; `order` tablosu henüz yok ama açılışta sorgu atılmaz.)

- [ ] **Step 8: Migration**

```bash
npm run migration:generate -- src/database/migrations/CreateOrders
npm run migration:run
```

Expected: `CREATE TABLE "order"` (`code` `character varying(6)` unique, `pickupCode` `character(4)`, `note` `character varying(300)`, zaman sütunları `TIMESTAMP WITH TIME ZONE`), `CREATE TABLE "order_item"` (`note` `character varying(140)`), `CREATE TABLE "order_request"` (unique `customerId, key`), `CREATE TABLE "payment"` (unique `orderId`), index'ler (`kitchenId, status`), (`customerId, status`), `order_item.orderId`, `order_request.createdAt` ve FK'ler (`order_item → order` `ON DELETE CASCADE`, `order_request → order` `ON DELETE CASCADE`). `kitchen` veya başka mevcut tabloya dokunan ifade varsa DURUP kullanıcıya bildir.

- [ ] **Step 9: Elle doğrula**

Run: `PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2-) psql -h localhost -U sofram -d sofram -c '\d "order"' -c '\d order_item' -c '\d order_request' -c '\d payment'`
Expected: dört tablo yukarıdaki sütunlarla; `order` üzerinde `IDX_…("kitchenId", status)` ve `("customerId", status)`.

- [ ] **Step 10: Commit**

```bash
npm test && npm run lint
git add src/orders src/payments src/app.module.ts src/database/migrations
git commit -m "feat(orders): add order, order item, request key and payment tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ödeme sağlayıcısı ve `PaymentsService`

**Files:**
- Create: `src/payments/provider/payment-provider.ts`, `src/payments/provider/dev-payment-provider.ts`, `src/payments/provider/payment-provider.provider.ts`, `src/payments/config/payments-config.type.ts`, `src/payments/config/payments.config.ts`, `src/payments/payments.service.ts`
- Test: `src/payments/provider/dev-payment-provider.spec.ts`, `src/payments/provider/payment-provider.provider.spec.ts`, `src/payments/payments.service.spec.ts`
- Modify: `src/payments/payments.module.ts`, `src/config/config.type.ts`, `src/app.module.ts`, `env-example-relational`, `.env`

**Interfaces:**
- Consumes: Task 3 (`Payment`, `PaymentStatus`, `NewPayment`, `PaymentRepository`), `ConfigService<AllConfigType>`, `validateConfig`.
- Produces:
  - `abstract class PaymentProvider { readonly name: string; charge(request: ChargeRequest): Promise<ChargeResult>; refund(request: RefundRequest): Promise<void> }`, `type ChargeRequest = { orderId: string; amountKurus: number }`, `type ChargeResult = { providerRef: string }`, `type RefundRequest = { providerRef: string; amountKurus: number }`, `class PaymentDeclinedError extends Error`.
  - `class DevPaymentProvider extends PaymentProvider` (`constructor(fail: boolean)`, `name = 'dev'`), `createPaymentProvider(config: ConfigService<AllConfigType>): PaymentProvider`, `paymentProviderProvider: Provider` (Faz 1 `PhoneTokenVerifier` deseni).
  - Config: `configService.getOrThrow('payments.provider', { infer: true })` (`'dev'`), `configService.get('payments.devPaymentFail', { infer: true })`.
  - `PaymentsService.charge(orderId: string, amountKurus: number): Promise<NewPayment>` (ret → `HttpException({ status: 402, error: 'paymentFailed' }, 402)`), `PaymentsService.refund(orderId: string): Promise<PaymentStatus | null>` (asla atmaz; başarısızlık `refund_failed`), `PaymentsService.findByOrderId(orderId: string): Promise<Payment | null>`.
  - `PaymentsModule` exports `PaymentsService`.

- [ ] **Step 1: Sağlayıcı — test**

`src/payments/provider/dev-payment-provider.spec.ts`:

```ts
import { DevPaymentProvider } from './dev-payment-provider';
import { PaymentDeclinedError } from './payment-provider';

describe('DevPaymentProvider', () => {
  it('should charge with a dev reference', async () => {
    await expect(
      new DevPaymentProvider(false).charge({ orderId: 'o1', amountKurus: 100 }),
    ).resolves.toEqual({ providerRef: expect.stringMatching(/^dev_/) });
  });

  it('should decline every charge while failing', async () => {
    await expect(
      new DevPaymentProvider(true).charge({ orderId: 'o1', amountKurus: 100 }),
    ).rejects.toBeInstanceOf(PaymentDeclinedError);
  });

  it('should always refund', async () => {
    await expect(new DevPaymentProvider(true).refund()).resolves.toBe(
      undefined,
    );
  });
});
```

`src/payments/provider/payment-provider.provider.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPaymentProvider } from './dev-payment-provider';
import { PaymentDeclinedError } from './payment-provider';
import { createPaymentProvider } from './payment-provider.provider';

const configWith = (values: {
  nodeEnv: string;
  provider?: string;
  devPaymentFail?: boolean;
}) => {
  const byKey: Record<string, unknown> = {
    'app.nodeEnv': values.nodeEnv,
    'payments.provider': values.provider ?? 'dev',
    'payments.devPaymentFail': values.devPaymentFail ?? false,
  };

  return {
    get: (key: string) => byKey[key],
    getOrThrow: (key: string) => byKey[key],
  } as unknown as ConfigService<AllConfigType>;
};

const charge = (nodeEnv: string, devPaymentFail: boolean) =>
  createPaymentProvider(configWith({ nodeEnv, devPaymentFail })).charge({
    orderId: 'o1',
    amountKurus: 100,
  });

describe('createPaymentProvider', () => {
  it('should bind the dev provider', () => {
    expect(
      createPaymentProvider(configWith({ nodeEnv: 'development' })),
    ).toBeInstanceOf(DevPaymentProvider);
  });

  it('should decline while DEV_PAYMENT_FAIL is on outside production', async () => {
    await expect(charge('development', true)).rejects.toBeInstanceOf(
      PaymentDeclinedError,
    );
  });

  it('should ignore DEV_PAYMENT_FAIL in production', async () => {
    await expect(charge('production', true)).resolves.toHaveProperty(
      'providerRef',
    );
  });

  it('should refuse an unknown provider', () => {
    expect(() =>
      createPaymentProvider(
        configWith({ nodeEnv: 'development', provider: 'stripe' }),
      ),
    ).toThrow(/PAYMENT_PROVIDER/);
  });
});
```

Run: `npx jest src/payments/provider` → FAIL (modüller yok).

- [ ] **Step 2: Sağlayıcı ve ödeme konfigürasyonu — kod**

`src/payments/provider/payment-provider.ts`:

```ts
export type ChargeRequest = { orderId: string; amountKurus: number };

export type ChargeResult = { providerRef: string };

export type RefundRequest = { providerRef: string; amountKurus: number };

/** The provider said no; the order is not placed. */
export class PaymentDeclinedError extends Error {}

/**
 * Takes and returns money for an order. Faz 3 ships only the dev provider; a
 * marketplace provider (sub-merchant onboarding) plugs in here in Faz 5.
 */
export abstract class PaymentProvider {
  /** Stored on the payment row (`payment.provider`). */
  abstract readonly name: string;

  /** Resolves with the provider's reference or rejects with PaymentDeclinedError. */
  abstract charge(request: ChargeRequest): Promise<ChargeResult>;

  /** Rejects when the provider refuses the refund. */
  abstract refund(request: RefundRequest): Promise<void>;
}
```

`src/payments/provider/dev-payment-provider.ts`:

```ts
import { randomUUID } from 'crypto';
import {
  ChargeRequest,
  ChargeResult,
  PaymentDeclinedError,
  PaymentProvider,
} from './payment-provider';

/** Moves no money. Declines every charge while `fail` is on (DEV_PAYMENT_FAIL). */
export class DevPaymentProvider extends PaymentProvider {
  readonly name = 'dev';

  constructor(private readonly fail: boolean) {
    super();
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    if (this.fail) {
      return Promise.reject(
        new PaymentDeclinedError(
          `DEV_PAYMENT_FAIL declined order ${request.orderId}`,
        ),
      );
    }

    return Promise.resolve({ providerRef: `dev_${randomUUID()}` });
  }

  refund(): Promise<void> {
    return Promise.resolve();
  }
}
```

`src/payments/provider/payment-provider.provider.ts`:

```ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPaymentProvider } from './dev-payment-provider';
import { PaymentProvider } from './payment-provider';

/**
 * PAYMENT_PROVIDER picks the implementation; `dev` is the only one so far.
 * DEV_PAYMENT_FAIL is a local test switch and is ignored in production.
 */
export const createPaymentProvider = (
  config: ConfigService<AllConfigType>,
): PaymentProvider => {
  const provider = config.getOrThrow('payments.provider', { infer: true });
  const isProduction =
    config.get('app.nodeEnv', { infer: true }) === 'production';

  if (provider === 'dev') {
    return new DevPaymentProvider(
      !isProduction &&
        config.get('payments.devPaymentFail', { infer: true }) === true,
    );
  }

  throw new Error(`PaymentProvider: unknown PAYMENT_PROVIDER "${provider}"`);
};

export const paymentProviderProvider: Provider = {
  provide: PaymentProvider,
  inject: [ConfigService],
  useFactory: createPaymentProvider,
};
```

`src/payments/config/payments-config.type.ts`:

```ts
export type PaymentsConfig = {
  /** PAYMENT_PROVIDER; only `dev` exists until Faz 5. */
  provider: 'dev';
  /** DEV_PAYMENT_FAIL: the dev provider declines every charge. Ignored in production. */
  devPaymentFail: boolean;
};
```

`src/payments/config/payments.config.ts`:

```ts
import { registerAs } from '@nestjs/config';
import { IsBooleanString, IsIn, IsOptional } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { PaymentsConfig } from './payments-config.type';

class EnvironmentVariablesValidator {
  @IsIn(['dev'])
  @IsOptional()
  PAYMENT_PROVIDER: string;

  @IsBooleanString()
  @IsOptional()
  DEV_PAYMENT_FAIL: string;
}

export default registerAs<PaymentsConfig>('payments', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    provider: 'dev',
    devPaymentFail: process.env.DEV_PAYMENT_FAIL === 'true',
  };
});
```

`src/config/config.type.ts` — `OrdersConfig` importunun altına `import { PaymentsConfig } from '../payments/config/payments-config.type';`, `AllConfigType`'ta `orders: OrdersConfig;` altına `payments: PaymentsConfig;` ekle.

`src/app.module.ts` — `import ordersConfig …` satırının altına `import paymentsConfig from './payments/config/payments.config';` ekle; `load` listesinde `ordersConfig,`'ten sonra `paymentsConfig,` ekle.

`env-example-relational` ve `.env` sonuna:

```
PAYMENT_PROVIDER=dev
DEV_PAYMENT_FAIL=false
```

Run: `npx jest src/payments/provider` → PASS (7 test).

- [ ] **Step 3: `PaymentsService` — test**

`src/payments/payments.service.spec.ts`:

```ts
import { HttpException, Logger } from '@nestjs/common';
import { Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentsService } from './payments.service';
import { DevPaymentProvider } from './provider/dev-payment-provider';
import { PaymentProvider } from './provider/payment-provider';

const paid = (overrides: Partial<Payment> = {}): Payment =>
  Object.assign(new Payment(), {
    id: 'pay1',
    orderId: 'o1',
    provider: 'dev',
    providerRef: 'dev_ref',
    amountKurus: 29400,
    status: PaymentStatus.paid,
    paidAt: new Date(),
    refundedAt: null,
    ...overrides,
  });

const build = (provider: PaymentProvider = new DevPaymentProvider(false)) => {
  const repository = {
    findByOrderId: jest.fn().mockResolvedValue(paid()),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PaymentsService(
    repository as unknown as PaymentRepository,
    provider,
  );
  return { service, repository };
};

describe('PaymentsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('charge', () => {
    it('should return a paid payment for the order total', async () => {
      const { service } = build();

      await expect(service.charge('o1', 29400)).resolves.toMatchObject({
        orderId: 'o1',
        provider: 'dev',
        providerRef: expect.stringMatching(/^dev_/),
        amountKurus: 29400,
        status: PaymentStatus.paid,
        refundedAt: null,
      });
    });

    it('should turn a decline into 402 paymentFailed', async () => {
      const { service } = build(new DevPaymentProvider(true));

      const error = await service.charge('o1', 29400).catch((e) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect((error as HttpException).getResponse()).toEqual({
        status: 402,
        error: 'paymentFailed',
      });
    });
  });

  describe('refund', () => {
    it('should refund a paid order', async () => {
      const { service, repository } = build();

      await expect(service.refund('o1')).resolves.toBe(PaymentStatus.refunded);
      expect(repository.update).toHaveBeenCalledWith('pay1', {
        status: PaymentStatus.refunded,
        refundedAt: expect.any(Date),
      });
    });

    it('should record refund_failed instead of throwing', async () => {
      const provider = new DevPaymentProvider(false);
      jest.spyOn(provider, 'refund').mockRejectedValue(new Error('down'));
      const { service, repository } = build(provider);

      await expect(service.refund('o1')).resolves.toBe(
        PaymentStatus.refundFailed,
      );
      expect(repository.update).toHaveBeenCalledWith('pay1', {
        status: PaymentStatus.refundFailed,
      });
    });

    it('should leave missing and already refunded payments alone', async () => {
      const { service, repository } = build();

      repository.findByOrderId.mockResolvedValueOnce(null);
      await expect(service.refund('o1')).resolves.toBeNull();

      repository.findByOrderId.mockResolvedValueOnce(
        paid({ status: PaymentStatus.refunded }),
      );
      await expect(service.refund('o1')).resolves.toBe(PaymentStatus.refunded);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
```

Run: `npx jest src/payments/payments.service.spec.ts` → FAIL (`Cannot find module './payments.service'`).

- [ ] **Step 4: `PaymentsService` ve modül — kod**

`src/payments/payments.service.ts`:

```ts
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NewPayment, Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentProvider } from './provider/payment-provider';

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * Charges an order being placed and returns the payment row for the
   * caller's transaction to store. A decline is a 402 `paymentFailed`; the
   * caller's transaction rolls back, so nothing is stored.
   */
  async charge(orderId: string, amountKurus: number): Promise<NewPayment> {
    try {
      const { providerRef } = await this.paymentProvider.charge({
        orderId,
        amountKurus,
      });

      return {
        orderId,
        provider: this.paymentProvider.name,
        providerRef,
        amountKurus,
        status: PaymentStatus.paid,
        paidAt: new Date(),
        refundedAt: null,
      };
    } catch (error) {
      this.logger.warn(
        `Charge declined for order ${orderId}: ${reasonOf(error)}`,
      );

      throw new HttpException(
        { status: HttpStatus.PAYMENT_REQUIRED, error: 'paymentFailed' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Gives a closed order's money back. Never throws: a refused refund is
   * stored as `refund_failed` and logged — the order closes either way.
   */
  async refund(orderId: string): Promise<PaymentStatus | null> {
    const payment = await this.paymentRepository.findByOrderId(orderId);

    if (!payment || payment.status !== PaymentStatus.paid) {
      return payment?.status ?? null;
    }

    try {
      await this.paymentProvider.refund({
        providerRef: payment.providerRef,
        amountKurus: payment.amountKurus,
      });
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.refunded,
        refundedAt: new Date(),
      });
      return PaymentStatus.refunded;
    } catch (error) {
      this.logger.error(
        `Refund failed for order ${orderId}: ${reasonOf(error)}`,
      );
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.refundFailed,
      });
      return PaymentStatus.refundFailed;
    }
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    return this.paymentRepository.findByOrderId(orderId);
  }
}
```

`src/payments/payments.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsService } from './payments.service';
import { paymentProviderProvider } from './provider/payment-provider.provider';

@Module({
  imports: [
    // do not remove this comment
    RelationalPaymentPersistenceModule,
  ],
  providers: [PaymentsService, paymentProviderProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

Run: `npx jest src/payments && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (12 test), tip hatası yok. Dev API'nin terminalinde yeniden başlarken `PaymentProvider` / DI hatası olmamalı.

- [ ] **Step 5: Commit**

```bash
npm test && npm run lint
git add src/payments src/config/config.type.ts src/app.module.ts env-example-relational
git commit -m "feat(payments): charge and refund behind a swappable PaymentProvider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Müşteri sipariş uçları (`/orders`) + ortak kapanış servisi

**Files:**
- Create: `src/orders/order-errors.ts`, `src/orders/order-lifecycle.service.ts`, `src/orders/orders.service.ts`, `src/orders/orders.controller.ts`, `src/orders/views.ts`, `src/orders/presenters.ts`, `src/orders/order.fixture.ts`, `src/orders/dto/quote-order.dto.ts`, `src/orders/dto/create-order.dto.ts`, `src/orders/dto/list-orders.dto.ts`
- Test: `src/orders/order-lifecycle.service.spec.ts`, `src/orders/orders.service.spec.ts`, `src/orders/presenters.spec.ts`
- Modify: `src/orders/orders.module.ts`, `src/products/infrastructure/persistence/product.repository.ts`, `src/products/infrastructure/persistence/relational/repositories/product.repository.ts`, `src/products/products.service.ts`, `src/utils/http/all-exceptions.filter.ts`, `src/utils/http/all-exceptions.filter.spec.ts`
- Create: `test/utils/orders.ts`, `test/user/orders.e2e-spec.ts`, `test/user/order-payment.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 (`quoteOrder`, `quoteFieldErrors`, `estimatedMinutesFor`, `transitionFor`, `STAMP_FOR`, `ROLLBACK_STATUSES`, `ACTIVE_STATUSES`, `CLOSED_STATUSES`, `generatePickupCode`, enum'lar), Task 2 (`KitchensService.findById`, `KitchensService.findByOwner`), Task 3 (`OrderRepository`, `InsufficientPortionsError`, `DuplicateOrderRequestError`, `Order`, `OrderItem`, `NewOrder`, `OrderPatch`, `DeliveryAddress`, `PersonName`), Task 4 (`PaymentsService.charge/refund/findByOrderId`, `PaymentStatus`), `AddressesService.findOwned`, `orNotFound`, `assertNoFieldErrors`, `infinityPagination`.
- Produces:
  - `orderStatusConflict(): ConflictException`, `orderTotalChanged(quote: OrderQuote): ConflictException` (`data: { quote }`), `activeOrdersExist(): ConflictException`.
  - `OrderLifecycleService.advance(order: Order, action: OrderAction, patch?: OrderPatch, now?: Date): Promise<Order>` (geçersiz/yarış → 409; `rejected|cancelled|expired`'a geçişte `closeAndRestock` + `PaymentsService.refund`), `OrderLifecycleService.expireOverdue(scope?: OverdueScope, now?: Date): Promise<number>`.
  - `OrdersService.quote(customerId, dto: QuoteOrderDto): Promise<OrderQuote>`, `create(customerId, dto: CreateOrderDto, idempotencyKey: string): Promise<{ order: CustomerOrderDetail; created: boolean }>`, `list(customerId, query: ListOrdersQueryDto): Promise<InfinityPaginationResponseDto<CustomerOrderCard>>`, `detail(customerId, id): Promise<CustomerOrderDetail>`, `cancel(customerId, id): Promise<CustomerOrderDetail>`, `assertNoActiveOrders(userId): Promise<void>` (409 `activeOrdersExist`), `clearDeliveryAddresses(customerId): Promise<void>`.
  - DTO'lar: `OrderItemInputDto { productId; quantity }`, `OrderTargetDto { kitchenId; fulfillment; addressId? }`, `QuoteOrderDto`, `CreateOrderItemDto { …; note? }`, `CreateOrderDto { items; note?; expectedTotalKurus; acceptedTerms }`, `ListOrdersQueryDto { scope; page; limit }`, `ListCookOrdersQueryDto { tab; page; limit }` (Task 6 kullanır).
  - Görünümler (`views.ts`): `OrderQuoteView`, `OrderIssueView`, `DeliveryAddressView`, `OrderItemView`, `OrderItemSummary`, `OrderKitchenSummary`, `OrderKitchenCard`, `KitchenAddressView`, `OrderPaymentView`, `CustomerOrderCard`, `OrderTimeline` (export, Task 6 kullanır), `CustomerOrderDetail`.
  - Presenter'lar: `shortName(person: PersonName): string | null`, `kitchenAddressFor(order: Order): KitchenAddressView | null`, `quoteView`, `itemView`, `timeline`, `customerOrderCard`, `customerOrderDetail(order, paymentStatus: PaymentStatus | null, deliveryBufferMinutes: number)`.
  - `ProductRepository.findByIds(ids: Product['id'][]): Promise<Product[]>`, `ProductsService.findByIds(ids)`.
  - `AllExceptionsFilter` 4xx yanıtında `getResponse().data` varsa zarfın `data`'sına koyar.
  - Fikstürler (`order.fixture.ts`): `CREATED`, `anItem(overrides?)`, `anOrder(overrides?)`.
  - e2e yardımcıları (`test/utils/orders.ts`): `Spot`, `ALL_WEEK`, `uniquePhone`, `randomSpot`, `northOf`, `phoneLogin`, `setName`, `addAddress`, `openKitchen(token, spot): Promise<string>` (kitchenId), `categoryId`, `addProduct`, `testDatabase()`.
  - REST: `POST /orders/quote` → 200; `POST /orders` → 201 (aynı anahtar → 200), 402/409/422; `GET /orders?scope=`; `GET /orders/:id`; `POST /orders/:id/cancel` → 200.

- [ ] **Step 1: Hata filtresi `data` geçirir — test ve kod**

`src/utils/http/all-exceptions.filter.spec.ts` — `@nestjs/common` importuna `ConflictException` ekle ve `it('should keep Nest default messages', …)` testinden önce:

```ts
  it('should pass a client error’s `data` through (409 orderTotalChanged)', () => {
    const { host, json } = hostCapturing();

    new AllExceptionsFilter().catch(
      new ConflictException({
        status: HttpStatus.CONFLICT,
        error: 'orderTotalChanged',
        data: { quote: { totalKurus: 33600 } },
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      data: { quote: { totalKurus: 33600 } },
      status: false,
      statusCode: 409,
      message: 'orderTotalChanged',
    });
  });
```

Run: `npx jest src/utils/http/all-exceptions.filter.spec.ts` → FAIL (`data: null`).

`src/utils/http/all-exceptions.filter.ts` — dosyanın tamamı:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiEnvelope } from './api-response.type';
import { ErrorTree, flattenErrors } from './flatten-errors';

type HttpErrorBody = {
  message?: string | string[];
  error?: string;
  errors?: ErrorTree;
  /** Extra payload for the client, e.g. `{ quote }` on 409 orderTotalChanged. */
  data?: unknown;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const clientError = isHttp && statusCode < 500;
    const body: ApiEnvelope<unknown> = {
      data: (clientError ? this.bodyOf(exception).data : undefined) ?? null,
      status: false,
      statusCode,
      message: clientError
        ? this.messageOf(exception)
        : 'Internal server error',
    };

    const errors = isHttp ? this.bodyOf(exception).errors : undefined;
    if (errors) {
      body.errors = flattenErrors(errors);
    }

    response.status(statusCode).json(body);
  }

  private bodyOf(exception: HttpException): HttpErrorBody {
    const raw = exception.getResponse();
    return typeof raw === 'string' ? { message: raw } : (raw as HttpErrorBody);
  }

  private messageOf(exception: HttpException): string {
    const { message, error } = this.bodyOf(exception);

    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof error === 'string') return error;
    return exception.message;
  }
}
```

Run: `npx jest src/utils/http` → PASS.

- [ ] **Step 2: Ürünleri id'yle bulma**

`src/products/infrastructure/persistence/product.repository.ts` — `findByKitchenId` soyut metodunun altına:

```ts
  /** Live (not deleted) products among `ids`, in no particular order. */
  abstract findByIds(ids: Product['id'][]): Promise<Product[]>;
```

`src/products/infrastructure/persistence/relational/repositories/product.repository.ts` — `typeorm` importunu `import { In, Repository } from 'typeorm';` yap ve `findOwned` metodundan önce:

```ts
  async findByIds(ids: Product['id'][]): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.productRepository.find({
      where: { id: In(ids) },
    });
    return entities.map((entity) => ProductMapper.toDomain(entity));
  }
```

`src/products/products.service.ts` — `listMine` metodundan önce:

```ts
  /** Order quotes: the requested products that still exist, any kitchen. */
  findByIds(ids: Product['id'][]): Promise<Product[]> {
    return this.productRepository.findByIds(ids);
  }
```

Run: `npx tsc --noEmit -p tsconfig.json` → hata yok.

- [ ] **Step 3: Hatalar, DTO'lar ve görünümler**

`src/orders/order-errors.ts`:

```ts
import { ConflictException, HttpStatus } from '@nestjs/common';
import { OrderQuote } from './order-pricing';

/** The order is no longer where the action expects it (a race, or a wrong action). */
export const orderStatusConflict = () =>
  new ConflictException({
    status: HttpStatus.CONFLICT,
    error: 'orderStatusConflict',
  });

/** Prices or fees moved since the client's quote; `data.quote` is the new one. */
export const orderTotalChanged = (quote: OrderQuote) =>
  new ConflictException({
    status: HttpStatus.CONFLICT,
    error: 'orderTotalChanged',
    data: { quote },
  });

/** Account deletion waits until no order is open on either side. */
export const activeOrdersExist = () =>
  new ConflictException({
    status: HttpStatus.CONFLICT,
    error: 'activeOrdersExist',
  });
```

`src/orders/dto/quote-order.dto.ts` (aynı ürün iki satırda gelirse `ArrayUnique` → 422; sepet ürün başına tek satır tutar):

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Fulfillment } from '../order.enums';

export class OrderItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: 20, example: 2 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

/** Where the order goes; shared by the quote and the order. */
export class OrderTargetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  kitchenId: string;

  @ApiProperty({ enum: Fulfillment })
  @IsEnum(Fulfillment)
  fulfillment: Fulfillment;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Teslimatta zorunlu; kullanıcının adreslerinden biri',
  })
  @ValidateIf((dto: OrderTargetDto) => dto.fulfillment === Fulfillment.delivery)
  @IsUUID()
  addressId?: string;
}

export class QuoteOrderDto extends OrderTargetDto {
  @ApiProperty({ type: () => OrderItemInputDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: OrderItemInputDto) => item.productId)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}
```

`src/orders/dto/create-order.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderItemInputDto, OrderTargetDto } from './quote-order.dto';

export class CreateOrderItemDto extends OrderItemInputDto {
  @ApiPropertyOptional({ nullable: true, example: 'Az acılı olsun' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  note?: string | null;
}

export class CreateOrderDto extends OrderTargetDto {
  @ApiProperty({ type: () => CreateOrderItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: CreateOrderItemDto) => item.productId)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiProperty({
    description:
      'Son teklifin totalKurus değeri; farklıysa 409 orderTotalChanged',
  })
  @IsInt()
  @Min(0)
  expectedTotalKurus: number;

  @ApiProperty({ description: 'Mesafeli satış sözleşmesi onayı; true olmalı' })
  @Equals(true, { message: 'mustBeAccepted' })
  acceptedTerms: boolean;
}
```

`src/orders/dto/list-orders.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CookTab, OrderScope } from '../order.enums';

class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ListOrdersQueryDto extends PageQueryDto {
  @ApiProperty({ enum: OrderScope })
  @IsEnum(OrderScope)
  scope: OrderScope;
}

export class ListCookOrdersQueryDto extends PageQueryDto {
  @ApiProperty({ enum: CookTab })
  @IsEnum(CookTab)
  tab: CookTab;
}
```

`src/orders/views.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleType } from '../catalog/catalog.enums';
import { FileType } from '../files/domain/file';
import { PaymentStatus } from '../payments/domain/payment';
import { OrderBlocker, OrderIssueKind } from './order-pricing';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';

export class OrderIssueView {
  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ enum: ['unavailable', 'insufficient_portions'] })
  kind: OrderIssueKind;

  @ApiPropertyOptional({ type: Number, description: 'Kalan porsiyon' })
  available?: number;
}

/** POST /orders/quote; also `data.quote` of a 409 orderTotalChanged. */
export class OrderQuoteView {
  @ApiProperty({ type: Number, description: 'kuruş' })
  subtotalKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  deliveryFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  serviceFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  freeDeliveryRemainingKurus: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  minOrderRemainingKurus: number | null;

  @ApiProperty({ type: Number, nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: Number })
  estimatedMinutes: number;

  @ApiProperty({ type: () => OrderIssueView, isArray: true })
  issues: OrderIssueView[];

  @ApiProperty({
    enum: [
      'kitchen_closed',
      'fulfillment_unavailable',
      'out_of_range',
      'below_minimum',
      'own_kitchen',
    ],
    isArray: true,
  })
  blockers: OrderBlocker[];

  @ApiProperty({ type: Boolean })
  canOrder: boolean;
}

export class DeliveryAddressView {
  @ApiProperty({ type: String })
  fullAddress: string;

  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: String })
  neighborhood: string;

  @ApiProperty({ type: String, nullable: true })
  buildingNo: string | null;

  @ApiProperty({ type: String, nullable: true })
  floor: string | null;

  @ApiProperty({ type: String, nullable: true })
  apartmentNo: string | null;

  @ApiProperty({ type: String, nullable: true })
  directions: string | null;

  @ApiProperty({ type: Number })
  latitude: number;

  @ApiProperty({ type: Number })
  longitude: number;
}

export class OrderItemView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  productId: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Number, description: 'kuruş' })
  unitPriceKurus: number;

  @ApiProperty({ enum: SaleType })
  saleType: SaleType;

  @ApiProperty({ type: Number, nullable: true })
  prepMinutes: number | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  photo: FileType | null;

  @ApiProperty({ type: Number })
  quantity: number;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;
}

export class OrderItemSummary {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Number })
  quantity: number;
}

export class OrderKitchenSummary {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: () => FileType, nullable: true })
  coverPhoto: FileType | null;
}

export class OrderKitchenCard extends OrderKitchenSummary {
  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: String, nullable: true, description: 'Ad S.' })
  cookName: string | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  cookPhoto: FileType | null;
}

/** The kitchen's exact address: pickup orders between accepted and ready only. */
export class KitchenAddressView {
  @ApiProperty({ type: String })
  fullAddress: string;

  @ApiProperty({ type: Number })
  latitude: number;

  @ApiProperty({ type: Number })
  longitude: number;
}

export class OrderPaymentView {
  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;
}

/** GET /orders */
export class CustomerOrderCard {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'S-7K3F' })
  code: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: Fulfillment })
  fulfillment: Fulfillment;

  @ApiProperty({ type: () => OrderKitchenSummary })
  kitchen: OrderKitchenSummary;

  @ApiProperty({ type: () => OrderItemSummary, isArray: true })
  items: OrderItemSummary[];

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;
}

/** Shared by the customer's and the cook's detail. */
export class OrderTimeline {
  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  acceptedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  preparingAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  readyAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  onTheWayAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  closedAt: Date | null;
}

/** GET /orders/:id */
export class CustomerOrderDetail extends OrderTimeline {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: Fulfillment })
  fulfillment: Fulfillment;

  @ApiProperty({ type: () => OrderItemView, isArray: true })
  items: OrderItemView[];

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  subtotalKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  deliveryFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  serviceFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty({ type: Number, nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: () => DeliveryAddressView, nullable: true })
  deliveryAddress: DeliveryAddressView | null;

  @ApiProperty({ type: String, nullable: true, description: 'Yalnız gel-al' })
  pickupCode: string | null;

  @ApiProperty({ type: () => OrderKitchenCard })
  kitchen: OrderKitchenCard;

  @ApiProperty({ type: () => KitchenAddressView, nullable: true })
  kitchenAddress: KitchenAddressView | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Kabulden önce: şimdi kabul edilse kaç dakikada hazır',
  })
  estimatedMinutes: number | null;

  @ApiProperty({ enum: OrderReason, nullable: true })
  reason: OrderReason | null;

  @ApiProperty({ enum: CancelledBy, nullable: true })
  cancelledBy: CancelledBy | null;

  @ApiProperty({ type: () => OrderPaymentView, nullable: true })
  payment: OrderPaymentView | null;
}
```

- [ ] **Step 4: Presenter'lar — test**

`src/orders/order.fixture.ts` (birim test fikstürleri; `.spec.ts` olmadığı için başka spec'ler import edebilir):

```ts
import { SaleType } from '../catalog/catalog.enums';
import { FileType } from '../files/domain/file';
import { Order } from './domain/order';
import { OrderItem } from './domain/order-item';
import { Fulfillment, OrderStatus } from './order.enums';

/** Unit-test fixtures for the order specs. */
export const CREATED = new Date('2026-10-12T09:30:00Z');

export const anItem = (overrides: Partial<OrderItem> = {}): OrderItem =>
  Object.assign(new OrderItem(), {
    id: 'i1',
    productId: 'p1',
    position: 0,
    name: 'Mantı',
    unitPriceKurus: 14000,
    saleType: SaleType.onDemand,
    prepMinutes: 45,
    photo: Object.assign(new FileType(), { id: 'f1', path: '/f1.png' }),
    quantity: 2,
    note: 'Az acılı',
    ...overrides,
  });

export const anOrder = (overrides: Partial<Order> = {}): Order =>
  Object.assign(new Order(), {
    id: 'o1',
    code: 'S-7K3F',
    customerId: 9,
    kitchenId: 'k1',
    status: OrderStatus.pending,
    fulfillment: Fulfillment.pickup,
    deliveryAddress: null,
    distanceKm: null,
    note: 'Kapıda arayın',
    subtotalKurus: 28000,
    deliveryFeeKurus: 0,
    serviceFeeKurus: 1400,
    totalKurus: 29400,
    pickupCode: '0427',
    expiresAt: new Date('2026-10-12T09:33:00Z'),
    estimatedReadyAt: null,
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    onTheWayAt: null,
    completedAt: null,
    closedAt: null,
    cancelledBy: null,
    reason: null,
    items: [anItem()],
    kitchen: {
      id: 'k1',
      ownerId: 7,
      name: 'Ayşe Teyze Mutfağı',
      coverPhoto: null,
      district: 'Kadıköy',
      fullAddress: 'Caferağa Mh. Moda Cd. No:10',
      latitude: 40.98771,
      longitude: 29.02249,
      cook: { firstName: 'Ayşe', lastName: 'yılmaz', photo: null },
    },
    customer: { firstName: 'Deniz', lastName: 'İnce' },
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  });
```

`src/orders/presenters.spec.ts`:

```ts
import { PaymentStatus } from '../payments/domain/payment';
import { anOrder } from './order.fixture';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  customerOrderCard,
  customerOrderDetail,
  kitchenAddressFor,
  shortName,
} from './presenters';

describe('shortName', () => {
  it('should keep the first name and the Turkish initial of the last', () => {
    expect(shortName({ firstName: 'Ayşe', lastName: 'yılmaz' })).toBe(
      'Ayşe Y.',
    );
    expect(shortName({ firstName: 'Deniz', lastName: 'İnce' })).toBe(
      'Deniz İ.',
    );
    expect(shortName({ firstName: 'Can', lastName: 'ışık' })).toBe('Can I.');
  });

  it('should cope with a missing last name or a deleted account', () => {
    expect(shortName({ firstName: 'Ayşe', lastName: null })).toBe('Ayşe');
    expect(shortName({ firstName: null, lastName: null })).toBeNull();
  });
});

describe('kitchenAddressFor', () => {
  it('should open the exact address for pickup from accepted to ready', () => {
    for (const status of [
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
    ]) {
      expect(kitchenAddressFor(anOrder({ status }))).toEqual({
        fullAddress: 'Caferağa Mh. Moda Cd. No:10',
        latitude: 40.98771,
        longitude: 29.02249,
      });
    }
  });

  it('should keep it closed before acceptance, after closing and for delivery', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.completed,
      OrderStatus.cancelled,
    ]) {
      expect(kitchenAddressFor(anOrder({ status }))).toBeNull();
    }

    expect(
      kitchenAddressFor(
        anOrder({
          status: OrderStatus.accepted,
          fulfillment: Fulfillment.delivery,
        }),
      ),
    ).toBeNull();
  });
});

describe('customerOrderCard', () => {
  it('should summarize the items and the kitchen', () => {
    expect(customerOrderCard(anOrder())).toMatchObject({
      code: 'S-7K3F',
      kitchen: { id: 'k1', name: 'Ayşe Teyze Mutfağı', coverPhoto: null },
      items: [{ name: 'Mantı', quantity: 2 }],
      totalKurus: 29400,
    });
  });
});

describe('customerOrderDetail', () => {
  it('should show the pickup code, the cook card and the payment', () => {
    expect(
      customerOrderDetail(anOrder(), PaymentStatus.paid, 15),
    ).toMatchObject({
      pickupCode: '0427',
      kitchen: { cookName: 'Ayşe Y.', district: 'Kadıköy' },
      kitchenAddress: null,
      estimatedMinutes: 45,
      payment: { status: PaymentStatus.paid },
      items: [{ name: 'Mantı', note: 'Az acılı', photo: { id: 'f1' } }],
    });
  });

  it('should drop estimatedMinutes once the cook has answered', () => {
    expect(
      customerOrderDetail(
        anOrder({ status: OrderStatus.accepted }),
        PaymentStatus.paid,
        15,
      ).estimatedMinutes,
    ).toBeNull();
  });

  it('should never carry the cook’s or the customer’s contact details', () => {
    const detail = customerOrderDetail(anOrder(), null, 15);

    expect(detail).not.toHaveProperty('customer');
    expect(detail).not.toHaveProperty('customerId');
    expect(detail.kitchen).not.toHaveProperty('ownerId');
    expect(detail.payment).toBeNull();
  });
});
```

Run: `npx jest src/orders/presenters.spec.ts` → FAIL (`Cannot find module './presenters'`).

- [ ] **Step 5: Presenter'lar — kod**

`src/orders/presenters.ts`:

```ts
import { PaymentStatus } from '../payments/domain/payment';
import { Order, PersonName } from './domain/order';
import { OrderItem } from './domain/order-item';
import { OrderQuote, estimatedMinutesFor } from './order-pricing';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  CustomerOrderCard,
  CustomerOrderDetail,
  KitchenAddressView,
  OrderItemView,
  OrderQuoteView,
} from './views';

/** "Ayşe Y." — the other side never sees a full name (or a phone number). */
export function shortName(person: PersonName): string | null {
  if (!person.firstName) {
    return null;
  }

  const initial = person.lastName?.charAt(0).toLocaleUpperCase('tr-TR');
  return initial ? `${person.firstName} ${initial}.` : person.firstName;
}

/** Faz 2 §1: the exact kitchen address opens for a confirmed pickup, and closes again. */
const KITCHEN_ADDRESS_STATUSES = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

export function kitchenAddressFor(order: Order): KitchenAddressView | null {
  if (
    order.fulfillment !== Fulfillment.pickup ||
    !KITCHEN_ADDRESS_STATUSES.includes(order.status)
  ) {
    return null;
  }

  return Object.assign(new KitchenAddressView(), {
    fullAddress: order.kitchen.fullAddress,
    latitude: order.kitchen.latitude,
    longitude: order.kitchen.longitude,
  });
}

export const quoteView = (quote: OrderQuote): OrderQuoteView =>
  Object.assign(new OrderQuoteView(), quote);

export const itemView = (item: OrderItem): OrderItemView =>
  Object.assign(new OrderItemView(), {
    id: item.id,
    productId: item.productId,
    name: item.name,
    unitPriceKurus: item.unitPriceKurus,
    saleType: item.saleType,
    prepMinutes: item.prepMinutes,
    photo: item.photo,
    quantity: item.quantity,
    note: item.note,
  });

/** The step indicator's timestamps; shared with the cook's detail. */
export const timeline = (order: Order) => ({
  createdAt: order.createdAt,
  expiresAt: order.expiresAt,
  estimatedReadyAt: order.estimatedReadyAt,
  acceptedAt: order.acceptedAt,
  preparingAt: order.preparingAt,
  readyAt: order.readyAt,
  onTheWayAt: order.onTheWayAt,
  completedAt: order.completedAt,
  closedAt: order.closedAt,
});

export function customerOrderCard(order: Order): CustomerOrderCard {
  return Object.assign(new CustomerOrderCard(), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    kitchen: {
      id: order.kitchen.id,
      name: order.kitchen.name,
      coverPhoto: order.kitchen.coverPhoto,
    },
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
    })),
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

export function customerOrderDetail(
  order: Order,
  paymentStatus: PaymentStatus | null,
  deliveryBufferMinutes: number,
): CustomerOrderDetail {
  return Object.assign(new CustomerOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    items: order.items.map(itemView),
    note: order.note,
    subtotalKurus: order.subtotalKurus,
    deliveryFeeKurus: order.deliveryFeeKurus,
    serviceFeeKurus: order.serviceFeeKurus,
    totalKurus: order.totalKurus,
    distanceKm: order.distanceKm,
    deliveryAddress: order.deliveryAddress,
    pickupCode: order.pickupCode,
    kitchen: {
      id: order.kitchen.id,
      name: order.kitchen.name,
      coverPhoto: order.kitchen.coverPhoto,
      district: order.kitchen.district,
      cookName: shortName(order.kitchen.cook),
      cookPhoto: order.kitchen.cook.photo,
    },
    kitchenAddress: kitchenAddressFor(order),
    estimatedMinutes:
      order.status === OrderStatus.pending
        ? estimatedMinutesFor(
            order.items,
            order.fulfillment,
            deliveryBufferMinutes,
          )
        : null,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
    payment: paymentStatus ? { status: paymentStatus } : null,
  });
}
```

Run: `npx jest src/orders/presenters.spec.ts` → PASS (8 test).

- [ ] **Step 6: Kapanış servisi — test**

`src/orders/order-lifecycle.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { Order } from './domain/order';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anOrder } from './order.fixture';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';

const NOW = new Date('2026-10-12T09:35:00Z');

const build = () => {
  const repository = {
    transition: jest
      .fn()
      .mockImplementation((id: string, _from, patch: Partial<Order>) =>
        Promise.resolve(anOrder({ id, ...patch })),
      ),
    closeAndRestock: jest
      .fn()
      .mockImplementation((id: string, _from, patch: Partial<Order>) =>
        Promise.resolve(anOrder({ id, ...patch })),
      ),
    findOverduePendingIds: jest.fn().mockResolvedValue([]),
  };
  const payments = { refund: jest.fn().mockResolvedValue('refunded') };
  const lifecycle = new OrderLifecycleService(
    repository as unknown as OrderRepository,
    payments as unknown as PaymentsService,
  );
  return { lifecycle, repository, payments };
};

describe('OrderLifecycleService.advance', () => {
  it('should guard the update with the allowed statuses and stamp the time', async () => {
    const { lifecycle, repository, payments } = build();

    const order = await lifecycle.advance(anOrder(), 'accept', {}, NOW);

    expect(repository.transition).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      { status: OrderStatus.accepted, acceptedAt: NOW },
    );
    expect(order.status).toBe(OrderStatus.accepted);
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('should pass extra fields through', async () => {
    const { lifecycle, repository } = build();
    const readyAt = new Date('2026-10-12T10:20:00Z');

    await lifecycle.advance(
      anOrder(),
      'accept',
      { estimatedReadyAt: readyAt },
      NOW,
    );

    expect(repository.transition).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      {
        status: OrderStatus.accepted,
        acceptedAt: NOW,
        estimatedReadyAt: readyAt,
      },
    );
  });

  it('should close, restock and then refund a rejected order', async () => {
    const { lifecycle, repository, payments } = build();

    await lifecycle.advance(
      anOrder(),
      'reject',
      { reason: OrderReason.tooBusy },
      NOW,
    );

    expect(repository.closeAndRestock).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      {
        status: OrderStatus.rejected,
        closedAt: NOW,
        reason: OrderReason.tooBusy,
      },
    );
    expect(payments.refund).toHaveBeenCalledWith('o1');
    expect(repository.closeAndRestock.mock.invocationCallOrder[0]).toBeLessThan(
      payments.refund.mock.invocationCallOrder[0],
    );
  });

  it('should refuse an action the status does not allow, without writing', async () => {
    const { lifecycle, repository } = build();

    await expect(
      lifecycle.advance(anOrder({ status: OrderStatus.accepted }), 'accept'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      lifecycle.advance(anOrder({ status: OrderStatus.ready }), 'dispatch'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('should report a lost race as orderStatusConflict and not refund', async () => {
    const { lifecycle, repository, payments } = build();
    repository.closeAndRestock.mockResolvedValueOnce(null);

    const error = await lifecycle
      .advance(anOrder(), 'customerCancel', {
        cancelledBy: CancelledBy.customer,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      status: 409,
      error: 'orderStatusConflict',
    });
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('should dispatch a delivery order from ready', async () => {
    const { lifecycle, repository } = build();

    await lifecycle.advance(
      anOrder({ status: OrderStatus.ready, fulfillment: Fulfillment.delivery }),
      'dispatch',
      {},
      NOW,
    );

    expect(repository.transition).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.ready],
      { status: OrderStatus.onTheWay, onTheWayAt: NOW },
    );
  });
});

describe('OrderLifecycleService.expireOverdue', () => {
  it('should expire each overdue order and refund only the ones it closed', async () => {
    const { lifecycle, repository, payments } = build();
    repository.findOverduePendingIds.mockResolvedValue(['o1', 'o2']);
    repository.closeAndRestock
      .mockResolvedValueOnce(anOrder({ id: 'o1' }))
      .mockResolvedValueOnce(null);

    await expect(lifecycle.expireOverdue({ customerId: 9 }, NOW)).resolves.toBe(
      1,
    );

    expect(repository.findOverduePendingIds).toHaveBeenCalledWith(NOW, {
      customerId: 9,
    });
    expect(repository.closeAndRestock).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      {
        status: OrderStatus.expired,
        closedAt: NOW,
        cancelledBy: CancelledBy.system,
        reason: null,
      },
    );
    expect(payments.refund).toHaveBeenCalledTimes(1);
    expect(payments.refund).toHaveBeenCalledWith('o1');
  });
});
```

Run: `npx jest src/orders/order-lifecycle.service.spec.ts` → FAIL (modül yok).

- [ ] **Step 7: Kapanış servisi — kod**

`src/orders/order-lifecycle.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { Order, OrderPatch } from './domain/order';
import {
  OrderRepository,
  OverdueScope,
} from './infrastructure/persistence/order.repository';
import { orderStatusConflict } from './order-errors';
import {
  OrderAction,
  ROLLBACK_STATUSES,
  STAMP_FOR,
  transitionFor,
} from './order-status';
import { CancelledBy, OrderStatus } from './order.enums';

/**
 * Every status change goes through here: a guarded UPDATE, the timestamp of
 * the new status, and — when an order is rejected, cancelled or expires — the
 * portions back on sale and the money back to the customer.
 */
@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly paymentsService: PaymentsService,
  ) {}

  /** Applies `action` or throws 409 orderStatusConflict. */
  async advance(
    order: Order,
    action: OrderAction,
    patch: OrderPatch = {},
    now: Date = new Date(),
  ): Promise<Order> {
    const transition = transitionFor(action, order.fulfillment);

    if (!transition || !transition.from.includes(order.status)) {
      throw orderStatusConflict();
    }

    const stamp = STAMP_FOR[transition.to];
    const changes: OrderPatch = {
      ...patch,
      status: transition.to,
      ...(stamp ? { [stamp]: now } : {}),
    };

    if (!ROLLBACK_STATUSES.includes(transition.to)) {
      const moved = await this.orderRepository.transition(
        order.id,
        transition.from,
        changes,
      );

      if (!moved) {
        throw orderStatusConflict();
      }

      return moved;
    }

    const closed = await this.orderRepository.closeAndRestock(
      order.id,
      transition.from,
      changes,
    );

    if (!closed) {
      throw orderStatusConflict();
    }

    await this.paymentsService.refund(order.id);
    return closed;
  }

  /**
   * Expires pending orders nobody answered in time — all of them (the
   * scheduled sweep) or one customer's / kitchen's (before a read).
   */
  async expireOverdue(
    scope: OverdueScope = {},
    now: Date = new Date(),
  ): Promise<number> {
    const ids = await this.orderRepository.findOverduePendingIds(now, scope);
    let expired = 0;

    for (const id of ids) {
      const closed = await this.orderRepository.closeAndRestock(
        id,
        [OrderStatus.pending],
        {
          status: OrderStatus.expired,
          closedAt: now,
          cancelledBy: CancelledBy.system,
          reason: null,
        },
      );

      // Someone answered or cancelled it in the meantime.
      if (closed) {
        expired++;
        await this.paymentsService.refund(id);
      }
    }

    return expired;
  }
}
```

Run: `npx jest src/orders/order-lifecycle.service.spec.ts` → PASS (7 test).

- [ ] **Step 8: Müşteri servisi — test**

`src/orders/orders.service.spec.ts` (saat sabit: `jest.useFakeTimers({ now })`; mutfak Pazartesi 11:00–20:00 açık):

```ts
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { SaleType } from '../catalog/catalog.enums';
import { Category } from '../categories/domain/category';
import { AllConfigType } from '../config/config.type';
import { FileType } from '../files/domain/file';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { PaymentStatus } from '../payments/domain/payment';
import { PaymentsService } from '../payments/payments.service';
import { Product } from '../products/domain/product';
import { ProductsService } from '../products/products.service';
import { NewOrder, Order } from './domain/order';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  DuplicateOrderRequestError,
  InsufficientPortionsError,
  OrderRepository,
} from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anOrder } from './order.fixture';
import { CancelledBy, Fulfillment, OrderStatus } from './order.enums';
import { OrdersService } from './orders.service';

// A Monday, 12:30 in Istanbul.
const NOW = new Date('2026-10-12T09:30:00Z');

const kitchen = Object.assign(new Kitchen(), {
  id: 'k1',
  ownerId: 7,
  name: 'Ayşe Teyze Mutfağı',
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 1500 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  freeDeliveryMinKurus: 30000,
  minOrderKurus: null,
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
});

const product = (overrides: Partial<Product>): Product =>
  Object.assign(new Product(), {
    kitchenId: 'k1',
    category: Object.assign(new Category(), { id: 'c1', isActive: true }),
    isActive: true,
    photos: [],
    ...overrides,
  });

const MANTI = product({
  id: 'manti',
  name: 'Mantı',
  priceKurus: 14000,
  saleType: SaleType.onDemand,
  prepMinutes: 45,
  portionsAvailable: null,
  photos: [
    Object.assign(new FileType(), { id: 'f1', path: '/f1.png' }),
    Object.assign(new FileType(), { id: 'f2', path: '/f2.png' }),
  ],
});

const KOFTE = product({
  id: 'kofte',
  name: 'Mercimek köftesi',
  priceKurus: 9000,
  saleType: SaleType.dailyPortion,
  prepMinutes: null,
  portionsAvailable: 5,
});

const HOME = Object.assign(new Address(), {
  id: 'a1',
  fullAddress: 'Osmanağa Mh. No:30',
  district: 'Kadıköy',
  neighborhood: 'Osmanağa',
  buildingNo: '30',
  latitude: 40.988 + 1 / 111.19,
  longitude: 29.022,
});

const CONFIG: Record<string, number> = {
  'orders.acceptMinutes': 3,
  'orders.deliveryBufferMinutes': 15,
  'orders.serviceFeePercent': 5,
  'discovery.coordPrecision': 3,
};

const dto = (overrides: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
  kitchenId: 'k1',
  fulfillment: Fulfillment.pickup,
  items: [
    { productId: 'kofte', quantity: 2, note: '  ' },
    { productId: 'manti', quantity: 1, note: 'Az acılı' },
  ],
  note: 'Kapıda arayın',
  // 18000 + 14000 + 5% service
  expectedTotalKurus: 33600,
  acceptedTerms: true,
  ...overrides,
});

const build = () => {
  const repository = {
    findIdByRequestKey: jest.fn().mockResolvedValue(null),
    place: jest.fn().mockResolvedValue(anOrder()),
    findForCustomer: jest.fn().mockResolvedValue(anOrder()),
    listForCustomer: jest.fn().mockResolvedValue([anOrder()]),
    hasActiveOrders: jest.fn().mockResolvedValue(false),
    clearDeliveryAddresses: jest.fn(),
  };
  const lifecycle = {
    expireOverdue: jest.fn().mockResolvedValue(0),
    advance: jest
      .fn()
      .mockImplementation((order: Order) =>
        Promise.resolve({ ...order, status: OrderStatus.cancelled }),
      ),
  };
  const kitchens = {
    findById: jest.fn().mockResolvedValue(kitchen),
    findByOwner: jest.fn().mockResolvedValue(null),
  };
  const products = { findByIds: jest.fn().mockResolvedValue([MANTI, KOFTE]) };
  const addresses = { findOwned: jest.fn().mockResolvedValue(HOME) };
  const payments = {
    charge: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
    findByOrderId: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
  };
  const config = { getOrThrow: (key: string) => CONFIG[key] };

  const service = new OrdersService(
    repository as unknown as OrderRepository,
    lifecycle as unknown as OrderLifecycleService,
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
    addresses as unknown as AddressesService,
    payments as unknown as PaymentsService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return {
    service,
    repository,
    lifecycle,
    kitchens,
    products,
    addresses,
    payments,
  };
};

describe('OrdersService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('quote', () => {
    it('should price the cart against the customer’s address', async () => {
      const { service, addresses } = build();

      const quote = await service.quote(9, {
        kitchenId: 'k1',
        fulfillment: Fulfillment.delivery,
        addressId: 'a1',
        items: [{ productId: 'manti', quantity: 1 }],
      });

      expect(addresses.findOwned).toHaveBeenCalledWith(9, 'a1');
      expect(quote).toMatchObject({
        subtotalKurus: 14000,
        deliveryFeeKurus: 1500,
        serviceFeeKurus: 700,
        totalKurus: 16200,
        distanceKm: 1,
        canOrder: true,
      });
    });

    it('should 404 a kitchen that is gone', async () => {
      const { service, kitchens } = build();
      kitchens.findById.mockResolvedValue(null);

      await expect(
        service.quote(9, {
          kitchenId: 'k1',
          fulfillment: Fulfillment.pickup,
          items: [{ productId: 'manti', quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('should snapshot the cart and place it in one go', async () => {
      const { service, repository, payments } = build();

      const result = await service.create(9, dto(), 'key-1');

      expect(result.created).toBe(true);
      const [{ order, requestKey, portions }, charge] = repository.place.mock
        .calls[0] as [
        { order: NewOrder; requestKey: string; portions: unknown },
        (draft: { id: string; totalKurus: number }) => Promise<unknown>,
      ];

      expect(requestKey).toBe('key-1');
      expect(portions).toEqual([{ productId: 'kofte', quantity: 2 }]);
      expect(order).toMatchObject({
        customerId: 9,
        kitchenId: 'k1',
        status: OrderStatus.pending,
        note: 'Kapıda arayın',
        subtotalKurus: 32000,
        serviceFeeKurus: 1600,
        totalKurus: 33600,
        deliveryAddress: null,
        expiresAt: new Date('2026-10-12T09:33:00Z'),
      });
      expect(order.pickupCode).toMatch(/^\d{4}$/);
      expect(order.items).toEqual([
        expect.objectContaining({
          productId: 'kofte',
          position: 0,
          unitPriceKurus: 9000,
          photo: null,
          note: null,
        }),
        expect.objectContaining({
          productId: 'manti',
          position: 1,
          prepMinutes: 45,
          photo: MANTI.photos[0],
          note: 'Az acılı',
        }),
      ]);

      await charge({ id: 'o1', totalKurus: 33600 });
      expect(payments.charge).toHaveBeenCalledWith('o1', 33600);
    });

    it('should copy the delivery address and leave out the pickup code', async () => {
      const { service, repository } = build();

      await service.create(
        9,
        dto({
          fulfillment: Fulfillment.delivery,
          addressId: 'a1',
          // 32000 ≥ 30000: free delivery
          expectedTotalKurus: 33600,
        }),
        'key-1',
      );

      expect(repository.place.mock.calls[0][0].order).toMatchObject({
        pickupCode: null,
        distanceKm: 1,
        deliveryFeeKurus: 0,
        deliveryAddress: {
          fullAddress: 'Osmanağa Mh. No:30',
          buildingNo: '30',
          floor: null,
        },
      });
    });

    it('should return the first order for a repeated key', async () => {
      const { service, repository } = build();
      repository.findIdByRequestKey.mockResolvedValue('o1');

      const result = await service.create(9, dto(), 'key-1');

      expect(result).toMatchObject({ created: false, order: { id: 'o1' } });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('should refuse what the quote blocks with dotted field errors', async () => {
      const { service, kitchens, repository } = build();
      kitchens.findById.mockResolvedValue({ ...kitchen, isPaused: true });

      const error = await service.create(9, dto(), 'key-1').catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { kitchenId: 'kitchen_closed' },
      });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('should answer a stale total with 409 and the new quote', async () => {
      const { service, repository } = build();

      const error = await service
        .create(9, dto({ expectedTotalKurus: 30000 }), 'key-1')
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        error: 'orderTotalChanged',
        data: { quote: { totalKurus: 33600, canOrder: true } },
      });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('should turn a lost race for the last portions into a 422 on that item', async () => {
      const { service, repository } = build();
      repository.place.mockRejectedValue(
        new InsufficientPortionsError('kofte'),
      );

      const error = await service.create(9, dto(), 'key-1').catch((e) => e);

      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { 'items.0.productId': 'insufficient_portions' },
      });
    });

    it('should hand back the winner of a concurrent duplicate key', async () => {
      const { service, repository } = build();
      repository.place.mockRejectedValue(new DuplicateOrderRequestError());
      repository.findIdByRequestKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('o1');

      await expect(service.create(9, dto(), 'key-1')).resolves.toMatchObject({
        created: false,
        order: { id: 'o1' },
      });
    });
  });

  describe('cancel', () => {
    it('should expire overdue orders first, then cancel as the customer', async () => {
      const { service, lifecycle } = build();

      const order = await service.cancel(9, 'o1');

      expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ customerId: 9 });
      expect(lifecycle.advance).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'o1' }),
        'customerCancel',
        { cancelledBy: CancelledBy.customer, reason: null },
      );
      expect(order.status).toBe(OrderStatus.cancelled);
    });

    it('should 404 someone else’s order', async () => {
      const { service, repository } = build();
      repository.findForCustomer.mockResolvedValue(null);

      await expect(service.cancel(9, 'o1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertNoActiveOrders', () => {
    it('should check both sides after expiring their overdue orders', async () => {
      const { service, lifecycle, kitchens, repository } = build();
      kitchens.findByOwner.mockResolvedValue(kitchen);
      repository.hasActiveOrders.mockResolvedValue(true);

      const error = await service.assertNoActiveOrders(7).catch((e) => e);

      expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ customerId: 7 });
      expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ kitchenId: 'k1' });
      expect(repository.hasActiveOrders).toHaveBeenCalledWith(7, 'k1');
      expect((error as ConflictException).getResponse()).toEqual({
        status: 409,
        error: 'activeOrdersExist',
      });
    });

    it('should pass without open orders', async () => {
      const { service, repository } = build();

      await expect(service.assertNoActiveOrders(9)).resolves.toBeUndefined();
      expect(repository.hasActiveOrders).toHaveBeenCalledWith(9, null);
    });
  });
});
```

Run: `npx jest src/orders/orders.service.spec.ts` → FAIL (modül yok).

- [ ] **Step 9: Müşteri servisi — kod**

`src/orders/orders.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { SaleType } from '../catalog/catalog.enums';
import { assertNoFieldErrors } from '../catalog/field-errors';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { PaymentsService } from '../payments/payments.service';
import { Product } from '../products/domain/product';
import { ProductsService } from '../products/products.service';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { DeliveryAddress, NewOrder, Order } from './domain/order';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { QuoteOrderDto } from './dto/quote-order.dto';
import {
  DuplicateOrderRequestError,
  InsufficientPortionsError,
  OrderRepository,
} from './infrastructure/persistence/order.repository';
import { generatePickupCode } from './order-codes';
import { activeOrdersExist, orderTotalChanged } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderQuote, quoteFieldErrors, quoteOrder } from './order-pricing';
import { ACTIVE_STATUSES, CLOSED_STATUSES } from './order-status';
import {
  CancelledBy,
  Fulfillment,
  OrderScope,
  OrderStatus,
} from './order.enums';
import { customerOrderCard, customerOrderDetail } from './presenters';
import { CustomerOrderCard, CustomerOrderDetail } from './views';

const MINUTE_MS = 60_000;

type Priced = {
  quote: OrderQuote;
  kitchen: Kitchen;
  products: Product[];
  address: Address | null;
};

const deliveryAddressOf = (address: Address): DeliveryAddress => ({
  fullAddress: address.fullAddress,
  district: address.district,
  neighborhood: address.neighborhood,
  buildingNo: address.buildingNo ?? null,
  floor: address.floor ?? null,
  apartmentNo: address.apartmentNo ?? null,
  directions: address.directions ?? null,
  latitude: address.latitude,
  longitude: address.longitude,
});

const textOrNull = (text: string | null | undefined) => text?.trim() || null;

/** The customer's side of ordering: quote, place, follow, cancel. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly lifecycle: OrderLifecycleService,
    private readonly kitchensService: KitchensService,
    private readonly productsService: ProductsService,
    private readonly addressesService: AddressesService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async quote(customerId: User['id'], dto: QuoteOrderDto): Promise<OrderQuote> {
    return (await this.price(customerId, dto, new Date())).quote;
  }

  /**
   * Places the order: same pricing as the quote, then one transaction that
   * takes the portions and the payment. A repeated Idempotency-Key returns
   * the first order (`created: false`).
   */
  async create(
    customerId: User['id'],
    dto: CreateOrderDto,
    idempotencyKey: string,
  ): Promise<{ order: CustomerOrderDetail; created: boolean }> {
    const replayed = await this.replay(customerId, idempotencyKey);

    if (replayed) {
      return { order: replayed, created: false };
    }

    const now = new Date();
    const { quote, kitchen, products, address } = await this.price(
      customerId,
      dto,
      now,
    );

    assertNoFieldErrors(quoteFieldErrors(quote, dto.items));

    if (quote.totalKurus !== dto.expectedTotalKurus) {
      throw orderTotalChanged(quote);
    }

    const order = this.draft(
      customerId,
      dto,
      quote,
      kitchen,
      products,
      address,
      now,
    );

    try {
      const placed = await this.orderRepository.place(
        {
          order,
          requestKey: idempotencyKey,
          portions: order.items
            .filter((item) => item.saleType === SaleType.dailyPortion)
            .map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
        },
        (draft) => this.paymentsService.charge(draft.id, draft.totalKurus),
      );

      return { order: await this.present(placed), created: true };
    } catch (error) {
      if (error instanceof DuplicateOrderRequestError) {
        const first = await this.replay(customerId, idempotencyKey);

        if (first) {
          return { order: first, created: false };
        }
      }

      if (error instanceof InsufficientPortionsError) {
        const index = dto.items.findIndex(
          (item) => item.productId === error.productId,
        );
        assertNoFieldErrors({
          [`items.${index}.productId`]: 'insufficient_portions',
        });
      }

      throw error;
    }
  }

  async list(
    customerId: User['id'],
    query: ListOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CustomerOrderCard>> {
    await this.lifecycle.expireOverdue({ customerId });

    const orders = await this.orderRepository.listForCustomer(
      customerId,
      query.scope === OrderScope.active ? ACTIVE_STATUSES : CLOSED_STATUSES,
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    return infinityPagination(orders.map(customerOrderCard), {
      page: query.page,
      limit: query.limit,
    });
  }

  async detail(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<CustomerOrderDetail> {
    await this.lifecycle.expireOverdue({ customerId });

    return this.present(
      await orNotFound(this.orderRepository.findForCustomer(customerId, id)),
    );
  }

  /** Only while the cook has not answered; anything later is a 409. */
  async cancel(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<CustomerOrderDetail> {
    await this.lifecycle.expireOverdue({ customerId });
    const order = await orNotFound(
      this.orderRepository.findForCustomer(customerId, id),
    );

    return this.present(
      await this.lifecycle.advance(order, 'customerCancel', {
        cancelledBy: CancelledBy.customer,
        reason: null,
      }),
    );
  }

  /** Account deletion is refused while an order is open on either side. */
  async assertNoActiveOrders(userId: User['id']): Promise<void> {
    const kitchen = await this.kitchensService.findByOwner(userId);

    await this.lifecycle.expireOverdue({ customerId: userId });

    if (kitchen) {
      await this.lifecycle.expireOverdue({ kitchenId: kitchen.id });
    }

    if (
      await this.orderRepository.hasActiveOrders(userId, kitchen?.id ?? null)
    ) {
      throw activeOrdersExist();
    }
  }

  /** Account deletion (KVKK): the customer's address copies go with the account. */
  clearDeliveryAddresses(customerId: User['id']): Promise<void> {
    return this.orderRepository.clearDeliveryAddresses(customerId);
  }

  private async price(
    customerId: User['id'],
    dto: QuoteOrderDto | CreateOrderDto,
    now: Date,
  ): Promise<Priced> {
    const kitchen = await orNotFound(
      this.kitchensService.findById(dto.kitchenId),
    );
    const address =
      dto.fulfillment === Fulfillment.delivery && dto.addressId
        ? await this.addressesService.findOwned(customerId, dto.addressId)
        : null;
    const products = await this.productsService.findByIds(
      dto.items.map((item) => item.productId),
    );

    const quote = quoteOrder({
      kitchen,
      products,
      items: dto.items,
      fulfillment: dto.fulfillment,
      address,
      customerId,
      now,
      config: {
        serviceFeePercent: this.configService.getOrThrow(
          'orders.serviceFeePercent',
          { infer: true },
        ),
        deliveryBufferMinutes: this.bufferMinutes(),
        coordPrecision: this.configService.getOrThrow(
          'discovery.coordPrecision',
          { infer: true },
        ),
      },
    });

    return { quote, kitchen, products, address };
  }

  private draft(
    customerId: User['id'],
    dto: CreateOrderDto,
    quote: OrderQuote,
    kitchen: Kitchen,
    products: Product[],
    address: Address | null,
    now: Date,
  ): NewOrder {
    const byId = new Map(products.map((product) => [product.id, product]));
    const acceptMinutes = this.configService.getOrThrow(
      'orders.acceptMinutes',
      { infer: true },
    );

    return {
      customerId,
      kitchenId: kitchen.id,
      status: OrderStatus.pending,
      fulfillment: dto.fulfillment,
      deliveryAddress: address ? deliveryAddressOf(address) : null,
      distanceKm: quote.distanceKm,
      note: textOrNull(dto.note),
      subtotalKurus: quote.subtotalKurus,
      deliveryFeeKurus: quote.deliveryFeeKurus,
      serviceFeeKurus: quote.serviceFeeKurus,
      totalKurus: quote.totalKurus,
      pickupCode:
        dto.fulfillment === Fulfillment.pickup ? generatePickupCode() : null,
      expiresAt: new Date(now.getTime() + acceptMinutes * MINUTE_MS),
      estimatedReadyAt: null,
      acceptedAt: null,
      preparingAt: null,
      readyAt: null,
      onTheWayAt: null,
      completedAt: null,
      closedAt: null,
      cancelledBy: null,
      reason: null,
      // canOrder held, so every product is here.
      items: dto.items.map((item, position) => {
        const product = byId.get(item.productId) as Product;

        return {
          productId: product.id,
          position,
          name: product.name,
          unitPriceKurus: product.priceKurus,
          saleType: product.saleType,
          prepMinutes: product.prepMinutes,
          photo: product.photos[0] ?? null,
          quantity: item.quantity,
          note: textOrNull(item.note),
        };
      }),
    };
  }

  private async replay(
    customerId: User['id'],
    idempotencyKey: string,
  ): Promise<CustomerOrderDetail | null> {
    const id = await this.orderRepository.findIdByRequestKey(
      customerId,
      idempotencyKey,
    );
    return id ? this.detail(customerId, id) : null;
  }

  private async present(order: Order): Promise<CustomerOrderDetail> {
    const payment = await this.paymentsService.findByOrderId(order.id);
    return customerOrderDetail(
      order,
      payment?.status ?? null,
      this.bufferMinutes(),
    );
  }

  private bufferMinutes(): number {
    return this.configService.getOrThrow('orders.deliveryBufferMinutes', {
      infer: true,
    });
  }
}
```

Run: `npx jest src/orders/orders.service.spec.ts` → PASS (13 test).

- [ ] **Step 10: Controller ve modül**

`src/orders/orders.controller.ts` (`Idempotency-Key` eksik/uuid değil → 422 `idempotencyKey: mustBeUuid`; tekrar eden anahtar `@Res({ passthrough: true })` ile 200'e çekilir — Nest varsayılan 201'i handler'dan önce yazar, zarf interceptor'ı son durum kodunu okur):

```ts
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { QuoteOrderDto } from './dto/quote-order.dto';
import { OrdersService } from './orders.service';
import { quoteView } from './presenters';
import {
  CustomerOrderCard,
  CustomerOrderDetail,
  OrderQuoteView,
} from './views';

/** The signed-in customer's orders; the cook's side is /kitchens/me/orders. */
@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'orders',
  version: '1',
})
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderQuoteView })
  async quote(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: QuoteOrderDto,
  ): Promise<OrderQuoteView> {
    return quoteView(await this.ordersService.quote(request.user.id, dto));
  }

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid; aynı anahtarla tekrar → ilk sipariş, 200',
  })
  @ApiCreatedResponse({ type: CustomerOrderDetail })
  async create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerOrderDetail> {
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { idempotencyKey: 'mustBeUuid' },
      });
    }

    const { order, created } = await this.ordersService.create(
      request.user.id,
      dto,
      idempotencyKey,
    );

    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(CustomerOrderCard) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CustomerOrderCard>> {
    return this.ordersService.list(request.user.id, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CustomerOrderDetail })
  detail(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOrderDetail> {
    return this.ordersService.detail(request.user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CustomerOrderDetail })
  cancel(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOrderDetail> {
    return this.ordersService.cancel(request.user.id, id);
  }
}
```

`src/orders/orders.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderPersistenceModule,
    PaymentsModule,
    KitchensModule,
    ProductsModule,
    AddressesModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderLifecycleService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: hata yok, PASS. Dev API yeniden başladıktan sonra `curl -s localhost:3001/docs-json | node -pe 'Object.keys(JSON.parse(require("fs").readFileSync(0)).paths).filter(p => p.includes("orders"))'` → `/api/v1/orders/quote`, `/api/v1/orders`, `/api/v1/orders/{id}`, `/api/v1/orders/{id}/cancel`.

- [ ] **Step 11: e2e — yardımcılar**

`test/utils/orders.ts`:

```ts
import request from 'supertest';
import { DataSource } from 'typeorm';
import { APP_URL } from './constants';

export type Spot = { latitude: number; longitude: number };

// 1×1 PNG; the local file driver accepts .png uploads.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const KM_PER_DEGREE = (Math.PI / 180) * 6371;

export const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '00:00',
  closesAt: '23:59',
}));

export const uniquePhone = (prefix: string) =>
  `${prefix}${String(Date.now()).slice(-7)}`;

/** A fresh spot per run, away from the Kadıköy dev seed and earlier runs. */
export const randomSpot = (): Spot => ({
  latitude: 37 + Math.random(),
  longitude: 30 + Math.random(),
});

export const northOf = (spot: Spot, km: number): Spot => ({
  latitude: spot.latitude + km / KM_PER_DEGREE,
  longitude: spot.longitude,
});

export async function phoneLogin(phoneNumber: string): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/auth/phone/login')
    .send({ idToken: `dev:${phoneNumber}` })
    .expect(200);
  return body.data.token;
}

export async function setName(
  token: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  await request(APP_URL)
    .patch('/api/v1/auth/me')
    .auth(token, { type: 'bearer' })
    .send({ firstName, lastName })
    .expect(200);
}

export async function addAddress(
  token: string,
  spot: Spot,
  fullAddress = 'Teslimat Sk. No:5',
): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/addresses')
    .auth(token, { type: 'bearer' })
    .send({
      title: 'Ev',
      fullAddress,
      district: 'Merkez',
      neighborhood: 'Deneme',
      ...spot,
    })
    .expect(201);
  return body.data.id;
}

/**
 * Opens a kitchen at `spot`, open around the clock, with pickup and delivery:
 * ₺15 up to 2 km, ₺25 up to 5 km, free from ₺300.
 */
export async function openKitchen(token: string, spot: Spot): Promise<string> {
  const addressId = await addAddress(token, spot, 'Deneme Mh. Test Sk. No:1');
  const { body } = await request(APP_URL)
    .post('/api/v1/kitchens/me')
    .auth(token, { type: 'bearer' })
    .send({
      name: 'Sipariş Mutfağı',
      addressId,
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryTiers: [
        { upToKm: 2, feeKurus: 1500 },
        { upToKm: 5, feeKurus: 2500 },
      ],
      freeDeliveryMinKurus: 30000,
      hours: ALL_WEEK,
    })
    .expect(201);
  return body.data.id;
}

export async function categoryId(token: string, slug: string): Promise<string> {
  const { body } = await request(APP_URL)
    .get('/api/v1/categories')
    .auth(token, { type: 'bearer' })
    .expect(200);
  return body.data.find((c: { slug: string }) => c.slug === slug).id;
}

export async function addProduct(
  token: string,
  product: Record<string, unknown>,
): Promise<string> {
  const upload = await request(APP_URL)
    .post('/api/v1/files/upload')
    .auth(token, { type: 'bearer' })
    .attach('file', PNG, 'dish.png')
    .expect(201);
  const { body } = await request(APP_URL)
    .post('/api/v1/kitchens/me/products')
    .auth(token, { type: 'bearer' })
    .send({
      allergens: [],
      dietTags: [],
      photoIds: [upload.body.data.file.id],
      ...product,
    })
    .expect(201);
  return body.data.id;
}

/** Direct SQL for what the API cannot do on demand (moving the clock). */
export const testDatabase = () =>
  new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
```

- [ ] **Step 12: e2e — müşteri akışı**

`test/user/orders.e2e-spec.ts` (Task 6–8 bu dosyaya blok ekler):

```ts
import { beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  addAddress,
  addProduct,
  categoryId,
  northOf,
  openKitchen,
  phoneLogin,
  randomSpot,
  setName,
  uniquePhone,
} from '../utils/orders';

type Card = { id: string } & Record<string, unknown>;
const ids = (body: { data: { data: Card[] } }) =>
  body.data.data.map((item) => item.id);

describe('Orders', () => {
  const app = APP_URL;
  const HOME = randomSpot();
  const customerPhone = uniquePhone('+90562');
  let cook: string;
  let customer: string;
  let kitchenId: string;
  let mantiId: string;
  let kofteId: string;
  let nearId: string;
  let farId: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token: string) =>
    request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const portionsOf = async (productId: string): Promise<number> => {
    const { body } = await get('/kitchens/me/products', cook).expect(200);
    return body.data.find((p: { id: string }) => p.id === productId)
      .portionsAvailable;
  };

  /** 2× köfte (daily) + 1× mantı (on demand), pickup: 32000 + 5% = 33600. */
  const cart = (overrides: Record<string, unknown> = {}) => ({
    kitchenId,
    fulfillment: 'pickup',
    items: [
      { productId: kofteId, quantity: 2, note: 'Az acılı' },
      { productId: mantiId, quantity: 1 },
    ],
    ...overrides,
  });

  const quote = (body: Record<string, unknown>, token = customer) =>
    post('/orders/quote', token).send(body);

  const placeOrder = (body: Record<string, unknown>, key = randomUUID()) =>
    post('/orders', customer)
      .set('Idempotency-Key', key)
      .send({ acceptedTerms: true, ...body });

  beforeAll(async () => {
    cook = await phoneLogin(uniquePhone('+90561'));
    customer = await phoneLogin(customerPhone);
    await setName(cook, 'Ayşe', 'Yılmaz');
    await setName(customer, 'Deniz', 'Arslan');

    kitchenId = await openKitchen(cook, HOME);
    const mainDish = await categoryId(cook, 'main-dish');
    mantiId = await addProduct(cook, {
      categoryId: mainDish,
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    kofteId = await addProduct(cook, {
      categoryId: mainDish,
      name: 'Mercimek köftesi',
      priceKurus: 9000,
      saleType: 'daily_portion',
      portionsAvailable: 5,
    });

    nearId = await addAddress(customer, northOf(HOME, 1));
    farId = await addAddress(customer, northOf(HOME, 10));
  });

  describe('quote', () => {
    it('should price a pickup order', () =>
      quote(cart({ items: [{ productId: mantiId, quantity: 1 }] }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({
            subtotalKurus: 14000,
            deliveryFeeKurus: 0,
            serviceFeeKurus: 700,
            totalKurus: 14700,
            freeDeliveryRemainingKurus: null,
            minOrderRemainingKurus: null,
            distanceKm: null,
            estimatedMinutes: 45,
            issues: [],
            blockers: [],
            canOrder: true,
          });
        }));

    it('should charge the delivery tier below the free-delivery threshold', () =>
      quote(
        cart({
          fulfillment: 'delivery',
          addressId: nearId,
          items: [{ productId: mantiId, quantity: 1 }],
        }),
      )
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            deliveryFeeKurus: 1500,
            totalKurus: 16200,
            freeDeliveryRemainingKurus: 16000,
            estimatedMinutes: 60,
            canOrder: true,
          });
          expect(body.data.distanceKm).toBeCloseTo(1, 0);
        }));

    it('should deliver for free from the threshold on', () =>
      quote(
        cart({
          fulfillment: 'delivery',
          addressId: nearId,
          items: [{ productId: mantiId, quantity: 3 }],
        }),
      )
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            subtotalKurus: 42000,
            deliveryFeeKurus: 0,
            serviceFeeKurus: 2100,
            freeDeliveryRemainingKurus: null,
          });
        }));

    it('should block an address beyond the last tier', () =>
      quote(cart({ fulfillment: 'delivery', addressId: farId }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            blockers: ['out_of_range'],
            canOrder: false,
          });
        }));

    it('should block an order below the kitchen minimum', async () => {
      await patch('/kitchens/me', cook)
        .send({ minOrderKurus: 50000 })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.minOrderKurus).toBe(50000);
        });

      await quote(cart({ items: [{ productId: mantiId, quantity: 1 }] }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            blockers: ['below_minimum'],
            minOrderRemainingKurus: 36000,
          });
        });

      await patch('/kitchens/me', cook)
        .send({ minOrderKurus: null })
        .expect(200);
    });

    it('should report too few portions with what is left', () =>
      quote(cart({ items: [{ productId: kofteId, quantity: 6 }] }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.issues).toEqual([
            { productId: kofteId, kind: 'insufficient_portions', available: 5 },
          ]);
        }));

    it('should block ordering from one’s own kitchen', () =>
      quote(cart(), cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.blockers).toEqual(['own_kitchen']);
        }));

    it('should 404 an unknown kitchen and someone else’s address', async () => {
      await quote(cart({ kitchenId: randomUUID() })).expect(404);

      const cookAddressId = await addAddress(cook, northOf(HOME, 1));
      await quote(
        cart({ fulfillment: 'delivery', addressId: cookAddressId }),
      ).expect(404);
    });

    it('should 422 a malformed cart', () =>
      quote(cart({ items: [{ productId: mantiId, quantity: 21 }] }))
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            expect.objectContaining({ field: 'items.0.quantity' }),
          ]);
        }));
  });

  let orderA: string;
  const keyA = randomUUID();

  describe('place, follow and cancel', () => {
    it('should place the order, take the portions and charge it', async () => {
      const { body } = await placeOrder(
        { ...cart(), note: 'Kapıda arayın', expectedTotalKurus: 33600 },
        keyA,
      ).expect(201);

      expect(body.data).toMatchObject({
        status: 'pending',
        fulfillment: 'pickup',
        totalKurus: 33600,
        note: 'Kapıda arayın',
        kitchenAddress: null,
        estimatedMinutes: 45,
        payment: { status: 'paid' },
        kitchen: { id: kitchenId, cookName: 'Ayşe Y.' },
      });
      expect(body.data.code).toMatch(/^S-[23456789A-HJKMNP-Z]{4}$/);
      expect(body.data.pickupCode).toMatch(/^\d{4}$/);
      expect(body.data.items.map((i: { note: string }) => i.note)).toEqual([
        'Az acılı',
        null,
      ]);
      orderA = body.data.id;

      expect(await portionsOf(kofteId)).toBe(3);
    });

    it('should return the same order for the same Idempotency-Key', async () => {
      const { body } = await placeOrder(
        { ...cart(), expectedTotalKurus: 33600 },
        keyA,
      ).expect(200);

      expect(body.data.id).toBe(orderA);
      expect(await portionsOf(kofteId)).toBe(3);
    });

    it('should answer a stale total with 409 and the new quote', () =>
      placeOrder({ ...cart(), expectedTotalKurus: 30000 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('orderTotalChanged');
          expect(body.data.quote).toMatchObject({
            totalKurus: 33600,
            canOrder: true,
          });
        }));

    it('should require a uuid Idempotency-Key', () =>
      post('/orders', customer)
        .send({ ...cart(), expectedTotalKurus: 33600, acceptedTerms: true })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'idempotencyKey', message: 'mustBeUuid' },
          ]);
        }));

    it('should require accepting the terms', () =>
      placeOrder({ ...cart(), expectedTotalKurus: 33600, acceptedTerms: false })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'acceptedTerms', message: 'mustBeAccepted' },
          ]);
        }));

    it('should refuse what the quote blocks', () =>
      placeOrder({
        ...cart({ fulfillment: 'delivery', addressId: farId }),
        expectedTotalKurus: 33600,
      })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'addressId', message: 'out_of_range' },
          ]);
        }));

    it('should list the order as active, not past', async () => {
      await get('/orders?scope=active', customer)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).toEqual([orderA]);
          expect(body.data.data[0]).toMatchObject({
            kitchen: { id: kitchenId },
            items: [
              { name: 'Mercimek köftesi', quantity: 2 },
              { name: 'Ev mantısı', quantity: 1 },
            ],
            totalKurus: 33600,
          });
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).not.toContain(orderA);
        });
    });

    it('should hide the order from everyone else', () =>
      get(`/orders/${orderA}`, cook).expect(404));

    it('should let the customer cancel while pending and give everything back', async () => {
      await post(`/orders/${orderA}/cancel`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'cancelled',
            cancelledBy: 'customer',
            reason: null,
            payment: { status: 'refunded' },
          });
          expect(body.data.closedAt).toEqual(expect.any(String));
        });

      expect(await portionsOf(kofteId)).toBe(5);

      await post(`/orders/${orderA}/cancel`, customer)
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('orderStatusConflict');
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).toContain(orderA);
        });
    });
  });
});
```

Run: `npm run test:e2e -- --runInBand test/user/orders.e2e-spec.ts`
Expected: PASS (18 test). Kırmızıysa dev API loglarına bak (`order` tablosu migration'ı uygulanmış mı, `ORDER_*` env'leri yüklü mü).

- [ ] **Step 13: e2e — reddedilen ödeme (ayrı API örneğiyle)**

`test/user/order-payment.e2e-spec.ts` (normal dev API'ye karşı **atlanır**; `DEV_PAYMENT_FAIL` çalışan sürecin env'i olduğu için testten değiştirilemez):

```ts
import { beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  addProduct,
  categoryId,
  openKitchen,
  phoneLogin,
  randomSpot,
  uniquePhone,
} from '../utils/orders';

/**
 * Needs an API started with DEV_PAYMENT_FAIL=true (see the plan's final
 * verification); skipped against the normal dev API.
 */
const describeWhenDeclining =
  process.env.DEV_PAYMENT_FAIL === 'true' ? describe : describe.skip;

describeWhenDeclining('Orders: declined payment', () => {
  const app = APP_URL;
  let cook: string;
  let customer: string;
  let kitchenId: string;
  let kofteId: string;

  const portions = async (): Promise<number> => {
    const { body } = await request(app)
      .get('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .expect(200);
    return body.data.find((p: { id: string }) => p.id === kofteId)
      .portionsAvailable;
  };

  beforeAll(async () => {
    cook = await phoneLogin(uniquePhone('+90564'));
    customer = await phoneLogin(uniquePhone('+90565'));
    kitchenId = await openKitchen(cook, randomSpot());
    kofteId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Mercimek köftesi',
      priceKurus: 9000,
      saleType: 'daily_portion',
      portionsAvailable: 5,
    });
  });

  it('should answer 402 paymentFailed and roll the order back', async () => {
    const key = randomUUID();
    const order = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId: kofteId, quantity: 2 }],
      expectedTotalKurus: 18900,
      acceptedTerms: true,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app)
        .post('/api/v1/orders')
        .auth(customer, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(order)
        .expect(402)
        .expect(({ body }) => {
          expect(body.message).toBe('paymentFailed');
        });
    }

    expect(await portions()).toBe(5);

    await request(app)
      .get('/api/v1/orders?scope=active')
      .auth(customer, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data).toEqual([]);
      });
  });
});
```

İkinci bir API'yi 3002'de `DEV_PAYMENT_FAIL=true` ile aç (ayrı terminal, arka planda; `dotenv` ve `ConfigModule` mevcut env değişkenlerini ezmez):

```bash
APP_PORT=3002 DEV_PAYMENT_FAIL=true npx ts-node -r tsconfig-paths/register src/main.ts > /tmp/sofram-3002.log 2>&1 &
until curl -s -o /dev/null localhost:3002/; do sleep 2; done
APP_PORT=3002 DEV_PAYMENT_FAIL=true npx env-cmd --no-override -- jest --config ./test/jest-e2e.json --runInBand test/user/order-payment.e2e-spec.ts
kill $(lsof -t -i :3002 -sTCP:LISTEN)
```

Expected: 1 test PASS (402 `paymentFailed` iki kez, porsiyon 5'te kalır, aktif sipariş yok). Normal paket: `npm run test:e2e -- --runInBand test/user/order-payment.e2e-spec.ts` → 1 skipped.

- [ ] **Step 14: Tüm paket ve commit**

```bash
npm test && npm run lint && npm run test:e2e -- --runInBand
git add src/orders src/products src/utils/http test/utils/orders.ts test/user/orders.e2e-spec.ts test/user/order-payment.e2e-spec.ts
git commit -m "feat(orders): quote, place, follow and cancel orders as a customer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Aşçı sipariş uçları (`/kitchens/me/orders`)

**Files:**
- Create: `src/orders/cook-orders.service.ts`, `src/orders/cook-orders.controller.ts`, `src/orders/dto/cook-order-actions.dto.ts`
- Test: `src/orders/cook-orders.service.spec.ts`
- Modify: `src/orders/views.ts` (sona ekleme), `src/orders/presenters.ts`, `src/orders/presenters.spec.ts`, `src/orders/orders.module.ts`, `test/user/orders.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 (`canTransition`, `OrderAction`, `estimatedMinutesFor`, `estimatedReadyAt`, `istanbulDayStart`, `istanbulWeekStart`, enum'lar), Task 2 (`KitchensService.findMine` — mutfak yoksa 404), Task 3 (`OrderRepository.listForKitchen/findForKitchen/countByStatus/completedTotals/hasCompleted`, `OrderPatch`), Task 5 (`OrderLifecycleService.advance/expireOverdue`, `orderStatusConflict`, `ListCookOrdersQueryDto`, `OrderTimeline`, `OrderItemView`, `DeliveryAddressView`, `shortName`, `itemView`, `timeline`, fikstürler, e2e yardımcıları).
- Produces:
  - `OrderReasonDto { reason: OrderReason }`, `CompleteOrderDto { pickupCode?: string }` (`/^\d{4}$/`, aksi `pickupCode: invalid`).
  - Görünümler: `CookOrderCard { id; code; status; fulfillment; distanceKm; customerName; items: OrderItemView[]; note; totalKurus; createdAt; expiresAt; estimatedReadyAt }`, `CookOrderDetail extends OrderTimeline { …; customerName; deliveryAddress; items; note; subtotalKurus; deliveryFeeKurus; serviceFeeKurus; totalKurus; reason; cancelledBy }` (`pickupCode` ve telefon yok), `CookTabCounts { new; preparing; ready }`, `CompletedTotalsView { orders; revenueKurus }`, `CookOrderSummary { counts; today; week; hasEverCompleted }`.
  - Presenter'lar: `cookOrderCard(order: Order): CookOrderCard`, `cookOrderDetail(order: Order): CookOrderDetail`.
  - `CookOrdersService.list(ownerId, query: ListCookOrdersQueryDto)`, `summary(ownerId): Promise<CookOrderSummary>`, `detail(ownerId, id)`, `accept(ownerId, id)`, `reject(ownerId, id, reason: OrderReason)`, `start(ownerId, id)`, `ready(ownerId, id)`, `dispatch(ownerId, id)`, `complete(ownerId, id, dto: CompleteOrderDto)`, `cancel(ownerId, id, reason: OrderReason)` — hepsi `Promise<CookOrderDetail>` (list hariç).
  - REST: `GET /kitchens/me/orders?tab=`, `GET /kitchens/me/orders/summary`, `GET /kitchens/me/orders/:id`, `POST /kitchens/me/orders/:id/{accept,reject,start,ready,dispatch,complete,cancel}` → 200.

- [ ] **Step 1: Aşçı görünümleri — test**

`src/orders/presenters.spec.ts` — dosyanın tamamı (müşteri testleri aynen, sona aşçı testleri):

```ts
import { PaymentStatus } from '../payments/domain/payment';
import { anOrder } from './order.fixture';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  cookOrderCard,
  cookOrderDetail,
  customerOrderCard,
  customerOrderDetail,
  kitchenAddressFor,
  shortName,
} from './presenters';

describe('shortName', () => {
  it('should keep the first name and the Turkish initial of the last', () => {
    expect(shortName({ firstName: 'Ayşe', lastName: 'yılmaz' })).toBe(
      'Ayşe Y.',
    );
    expect(shortName({ firstName: 'Deniz', lastName: 'İnce' })).toBe(
      'Deniz İ.',
    );
    expect(shortName({ firstName: 'Can', lastName: 'ışık' })).toBe('Can I.');
  });

  it('should cope with a missing last name or a deleted account', () => {
    expect(shortName({ firstName: 'Ayşe', lastName: null })).toBe('Ayşe');
    expect(shortName({ firstName: null, lastName: null })).toBeNull();
  });
});

describe('kitchenAddressFor', () => {
  it('should open the exact address for pickup from accepted to ready', () => {
    for (const status of [
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
    ]) {
      expect(kitchenAddressFor(anOrder({ status }))).toEqual({
        fullAddress: 'Caferağa Mh. Moda Cd. No:10',
        latitude: 40.98771,
        longitude: 29.02249,
      });
    }
  });

  it('should keep it closed before acceptance, after closing and for delivery', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.completed,
      OrderStatus.cancelled,
    ]) {
      expect(kitchenAddressFor(anOrder({ status }))).toBeNull();
    }

    expect(
      kitchenAddressFor(
        anOrder({
          status: OrderStatus.accepted,
          fulfillment: Fulfillment.delivery,
        }),
      ),
    ).toBeNull();
  });
});

describe('customerOrderCard', () => {
  it('should summarize the items and the kitchen', () => {
    expect(customerOrderCard(anOrder())).toMatchObject({
      code: 'S-7K3F',
      kitchen: { id: 'k1', name: 'Ayşe Teyze Mutfağı', coverPhoto: null },
      items: [{ name: 'Mantı', quantity: 2 }],
      totalKurus: 29400,
    });
  });
});

describe('customerOrderDetail', () => {
  it('should show the pickup code, the cook card and the payment', () => {
    expect(
      customerOrderDetail(anOrder(), PaymentStatus.paid, 15),
    ).toMatchObject({
      pickupCode: '0427',
      kitchen: { cookName: 'Ayşe Y.', district: 'Kadıköy' },
      kitchenAddress: null,
      estimatedMinutes: 45,
      payment: { status: PaymentStatus.paid },
      items: [{ name: 'Mantı', note: 'Az acılı', photo: { id: 'f1' } }],
    });
  });

  it('should drop estimatedMinutes once the cook has answered', () => {
    expect(
      customerOrderDetail(
        anOrder({ status: OrderStatus.accepted }),
        PaymentStatus.paid,
        15,
      ).estimatedMinutes,
    ).toBeNull();
  });

  it('should never carry the cook’s or the customer’s contact details', () => {
    const detail = customerOrderDetail(anOrder(), null, 15);

    expect(detail).not.toHaveProperty('customer');
    expect(detail).not.toHaveProperty('customerId');
    expect(detail.kitchen).not.toHaveProperty('ownerId');
    expect(detail.payment).toBeNull();
  });
});

describe('cook views', () => {
  it('should name the customer briefly and keep the pickup code out', () => {
    for (const view of [cookOrderCard(anOrder()), cookOrderDetail(anOrder())]) {
      expect(view).toMatchObject({
        customerName: 'Deniz İ.',
        items: [{ name: 'Mantı', note: 'Az acılı' }],
        note: 'Kapıda arayın',
      });
      expect(view).not.toHaveProperty('pickupCode');
      expect(view).not.toHaveProperty('customerId');
      expect(view).not.toHaveProperty('payment');
    }
  });

  it('should show the delivery address to the cook', () => {
    const deliveryAddress = {
      fullAddress: 'Osmanağa Mh. No:30',
      district: 'Kadıköy',
      neighborhood: 'Osmanağa',
      buildingNo: '30',
      floor: '2',
      apartmentNo: '4',
      directions: null,
      latitude: 40.99,
      longitude: 29.03,
    };

    expect(
      cookOrderDetail(
        anOrder({ fulfillment: Fulfillment.delivery, deliveryAddress }),
      ).deliveryAddress,
    ).toEqual(deliveryAddress);
  });
});
```

Run: `npx jest src/orders/presenters.spec.ts` → FAIL (`cookOrderCard` export edilmiyor).

- [ ] **Step 2: Aşçı görünümleri — kod**

`src/orders/views.ts` — dosyanın **sonuna** ekle:

```ts
/** GET /kitchens/me/orders — enough to answer a new order from the list. */
export class CookOrderCard {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: Fulfillment })
  fulfillment: Fulfillment;

  @ApiProperty({ type: Number, nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'Ad S.' })
  customerName: string | null;

  @ApiProperty({ type: () => OrderItemView, isArray: true })
  items: OrderItemView[];

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;
}

/** GET /kitchens/me/orders/:id — never the pickup code or a phone number. */
export class CookOrderDetail extends OrderTimeline {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ enum: Fulfillment })
  fulfillment: Fulfillment;

  @ApiProperty({ type: Number, nullable: true })
  distanceKm: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'Ad S.' })
  customerName: string | null;

  @ApiProperty({ type: () => DeliveryAddressView, nullable: true })
  deliveryAddress: DeliveryAddressView | null;

  @ApiProperty({ type: () => OrderItemView, isArray: true })
  items: OrderItemView[];

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  subtotalKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  deliveryFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  serviceFeeKurus: number;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;

  @ApiProperty({ enum: OrderReason, nullable: true })
  reason: OrderReason | null;

  @ApiProperty({ enum: CancelledBy, nullable: true })
  cancelledBy: CancelledBy | null;
}

export class CookTabCounts {
  @ApiProperty({ type: Number })
  new: number;

  @ApiProperty({ type: Number })
  preparing: number;

  @ApiProperty({ type: Number })
  ready: number;
}

export class CompletedTotalsView {
  @ApiProperty({ type: Number })
  orders: number;

  @ApiProperty({ type: Number, description: 'Ara toplam, kuruş' })
  revenueKurus: number;
}

/** GET /kitchens/me/orders/summary */
export class CookOrderSummary {
  @ApiProperty({ type: () => CookTabCounts })
  counts: CookTabCounts;

  @ApiProperty({
    type: () => CompletedTotalsView,
    description: 'Bugün (İstanbul) tamamlananlar',
  })
  today: CompletedTotalsView;

  @ApiProperty({
    type: () => CompletedTotalsView,
    description: 'Pazartesiden beri tamamlananlar',
  })
  week: CompletedTotalsView;

  @ApiProperty({ type: Boolean })
  hasEverCompleted: boolean;
}
```

`src/orders/presenters.ts` — dosyanın tamamı:

```ts
import { PaymentStatus } from '../payments/domain/payment';
import { Order, PersonName } from './domain/order';
import { OrderItem } from './domain/order-item';
import { OrderQuote, estimatedMinutesFor } from './order-pricing';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  CookOrderCard,
  CookOrderDetail,
  CustomerOrderCard,
  CustomerOrderDetail,
  KitchenAddressView,
  OrderItemView,
  OrderQuoteView,
} from './views';

/** "Ayşe Y." — the other side never sees a full name (or a phone number). */
export function shortName(person: PersonName): string | null {
  if (!person.firstName) {
    return null;
  }

  const initial = person.lastName?.charAt(0).toLocaleUpperCase('tr-TR');
  return initial ? `${person.firstName} ${initial}.` : person.firstName;
}

/** Faz 2 §1: the exact kitchen address opens for a confirmed pickup, and closes again. */
const KITCHEN_ADDRESS_STATUSES = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

export function kitchenAddressFor(order: Order): KitchenAddressView | null {
  if (
    order.fulfillment !== Fulfillment.pickup ||
    !KITCHEN_ADDRESS_STATUSES.includes(order.status)
  ) {
    return null;
  }

  return Object.assign(new KitchenAddressView(), {
    fullAddress: order.kitchen.fullAddress,
    latitude: order.kitchen.latitude,
    longitude: order.kitchen.longitude,
  });
}

export const quoteView = (quote: OrderQuote): OrderQuoteView =>
  Object.assign(new OrderQuoteView(), quote);

export const itemView = (item: OrderItem): OrderItemView =>
  Object.assign(new OrderItemView(), {
    id: item.id,
    productId: item.productId,
    name: item.name,
    unitPriceKurus: item.unitPriceKurus,
    saleType: item.saleType,
    prepMinutes: item.prepMinutes,
    photo: item.photo,
    quantity: item.quantity,
    note: item.note,
  });

/** The step indicator's timestamps; shared with the cook's detail. */
export const timeline = (order: Order) => ({
  createdAt: order.createdAt,
  expiresAt: order.expiresAt,
  estimatedReadyAt: order.estimatedReadyAt,
  acceptedAt: order.acceptedAt,
  preparingAt: order.preparingAt,
  readyAt: order.readyAt,
  onTheWayAt: order.onTheWayAt,
  completedAt: order.completedAt,
  closedAt: order.closedAt,
});

export function customerOrderCard(order: Order): CustomerOrderCard {
  return Object.assign(new CustomerOrderCard(), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    kitchen: {
      id: order.kitchen.id,
      name: order.kitchen.name,
      coverPhoto: order.kitchen.coverPhoto,
    },
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
    })),
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

export function customerOrderDetail(
  order: Order,
  paymentStatus: PaymentStatus | null,
  deliveryBufferMinutes: number,
): CustomerOrderDetail {
  return Object.assign(new CustomerOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    items: order.items.map(itemView),
    note: order.note,
    subtotalKurus: order.subtotalKurus,
    deliveryFeeKurus: order.deliveryFeeKurus,
    serviceFeeKurus: order.serviceFeeKurus,
    totalKurus: order.totalKurus,
    distanceKm: order.distanceKm,
    deliveryAddress: order.deliveryAddress,
    pickupCode: order.pickupCode,
    kitchen: {
      id: order.kitchen.id,
      name: order.kitchen.name,
      coverPhoto: order.kitchen.coverPhoto,
      district: order.kitchen.district,
      cookName: shortName(order.kitchen.cook),
      cookPhoto: order.kitchen.cook.photo,
    },
    kitchenAddress: kitchenAddressFor(order),
    estimatedMinutes:
      order.status === OrderStatus.pending
        ? estimatedMinutesFor(
            order.items,
            order.fulfillment,
            deliveryBufferMinutes,
          )
        : null,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
    payment: paymentStatus ? { status: paymentStatus } : null,
  });
}

export function cookOrderCard(order: Order): CookOrderCard {
  return Object.assign(new CookOrderCard(), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    distanceKm: order.distanceKm,
    customerName: shortName(order.customer),
    items: order.items.map(itemView),
    note: order.note,
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

export function cookOrderDetail(order: Order): CookOrderDetail {
  return Object.assign(new CookOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
    status: order.status,
    fulfillment: order.fulfillment,
    distanceKm: order.distanceKm,
    customerName: shortName(order.customer),
    deliveryAddress: order.deliveryAddress,
    items: order.items.map(itemView),
    note: order.note,
    subtotalKurus: order.subtotalKurus,
    deliveryFeeKurus: order.deliveryFeeKurus,
    serviceFeeKurus: order.serviceFeeKurus,
    totalKurus: order.totalKurus,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
  });
}
```

Run: `npx jest src/orders/presenters.spec.ts` → PASS (10 test).

- [ ] **Step 3: Aşçı servisi — test**

`src/orders/cook-orders.service.spec.ts` (saat sabit: 2026-10-18 Pazar 13:00 İstanbul; gün başı `2026-10-17T21:00Z`, hafta başı `2026-10-11T21:00Z`):

```ts
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SaleType } from '../catalog/catalog.enums';
import { AllConfigType } from '../config/config.type';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from './domain/order';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anItem, anOrder } from './order.fixture';
import {
  CancelledBy,
  CookTab,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';
import { CookOrdersService } from './cook-orders.service';

// A Sunday, 13:00 in Istanbul.
const NOW = new Date('2026-10-18T10:00:00Z');

const build = (order: Order = anOrder()) => {
  const repository = {
    findForKitchen: jest.fn().mockResolvedValue(order),
    listForKitchen: jest.fn().mockResolvedValue([order]),
    countByStatus: jest.fn().mockResolvedValue({
      [OrderStatus.pending]: 2,
      [OrderStatus.accepted]: 1,
      [OrderStatus.preparing]: 1,
      [OrderStatus.onTheWay]: 1,
    }),
    completedTotals: jest
      .fn()
      .mockResolvedValueOnce({ orders: 3, revenueKurus: 42000 })
      .mockResolvedValueOnce({ orders: 9, revenueKurus: 126000 }),
    hasCompleted: jest.fn().mockResolvedValue(true),
  };
  const lifecycle = {
    expireOverdue: jest.fn().mockResolvedValue(0),
    advance: jest
      .fn()
      .mockImplementation((current: Order, _action, patch) =>
        Promise.resolve({ ...current, ...patch }),
      ),
  };
  const kitchens = {
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'orders.deliveryBufferMinutes': 15 })[key],
  };

  const service = new CookOrdersService(
    repository as unknown as OrderRepository,
    lifecycle as unknown as OrderLifecycleService,
    kitchens as unknown as KitchensService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, repository, lifecycle, kitchens };
};

describe('CookOrdersService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should 404 a user without a kitchen', async () => {
    const { service, kitchens } = build();
    kitchens.findMine.mockRejectedValue(new NotFoundException());

    await expect(
      service.list(7, { tab: CookTab.new, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should expire overdue orders before listing a tab', async () => {
    const { service, repository, lifecycle } = build();

    const page = await service.list(7, {
      tab: CookTab.done,
      page: 2,
      limit: 10,
    });

    expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ kitchenId: 'k1' });
    expect(repository.listForKitchen).toHaveBeenCalledWith(
      'k1',
      CookTab.done,
      new Date('2026-10-17T21:00:00Z'),
      { offset: 10, limit: 10 },
    );
    expect(page.data[0]).toMatchObject({ id: 'o1', customerName: 'Deniz İ.' });
  });

  it('should 404 another kitchen’s order', async () => {
    const { service, repository } = build();
    repository.findForKitchen.mockResolvedValue(null);

    await expect(service.detail(7, 'o1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should sum the tabs, today, the week and the first completion', async () => {
    const { service, repository } = build();

    await expect(service.summary(7)).resolves.toEqual({
      counts: { new: 2, preparing: 2, ready: 1 },
      today: { orders: 3, revenueKurus: 42000 },
      week: { orders: 9, revenueKurus: 126000 },
      hasEverCompleted: true,
    });
    expect(repository.completedTotals).toHaveBeenNthCalledWith(
      1,
      'k1',
      new Date('2026-10-17T21:00:00Z'),
    );
    expect(repository.completedTotals).toHaveBeenNthCalledWith(
      2,
      'k1',
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should promise the order for the longest prep plus the delivery buffer', async () => {
    const { service, lifecycle } = build(
      anOrder({
        fulfillment: Fulfillment.delivery,
        items: [
          anItem({ prepMinutes: 20 }),
          anItem({ saleType: SaleType.dailyPortion, prepMinutes: null }),
        ],
      }),
    );

    await service.accept(7, 'o1');

    expect(lifecycle.advance).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1' }),
      'accept',
      { estimatedReadyAt: new Date('2026-10-18T10:35:00Z') },
      NOW,
    );
  });

  it('should reject and cancel with the cook’s reason', async () => {
    const { service, lifecycle } = build();

    await service.reject(7, 'o1', OrderReason.tooBusy);
    await service.cancel(7, 'o1', OrderReason.outOfIngredients);

    expect(lifecycle.advance).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'reject',
      { reason: OrderReason.tooBusy },
    );
    expect(lifecycle.advance).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'cookCancel',
      { cancelledBy: CancelledBy.cook, reason: OrderReason.outOfIngredients },
    );
  });

  describe('complete', () => {
    const ready = anOrder({ status: OrderStatus.ready, pickupCode: '0427' });

    it('should require the pickup code', async () => {
      const { service, lifecycle } = build(ready);

      const error = await service.complete(7, 'o1', {}).catch((e) => e);

      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { pickupCode: 'required' },
      });
      expect(lifecycle.advance).not.toHaveBeenCalled();
    });

    it('should refuse a wrong pickup code', async () => {
      const { service } = build(ready);

      const error = await service
        .complete(7, 'o1', { pickupCode: '1234' })
        .catch((e) => e);

      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { pickupCode: 'invalid' },
      });
    });

    it('should complete with the right code', async () => {
      const { service, lifecycle } = build(ready);

      await service.complete(7, 'o1', { pickupCode: '0427' });

      expect(lifecycle.advance).toHaveBeenCalledWith(ready, 'complete');
    });

    it('should not ask for a code on a delivery order', async () => {
      const { service, lifecycle } = build(
        anOrder({
          status: OrderStatus.onTheWay,
          fulfillment: Fulfillment.delivery,
          pickupCode: null,
        }),
      );

      await service.complete(7, 'o1', {});

      expect(lifecycle.advance).toHaveBeenCalled();
    });

    it('should report the wrong status before checking the code', async () => {
      const { service } = build(anOrder({ status: OrderStatus.preparing }));

      await expect(service.complete(7, 'o1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
```

Run: `npx jest src/orders/cook-orders.service.spec.ts` → FAIL (modül yok).

- [ ] **Step 4: Aşçı servisi — kod**

`src/orders/dto/cook-order-actions.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { OrderReason } from '../order.enums';

/** reject and the cook's cancel. */
export class OrderReasonDto {
  @ApiProperty({ enum: OrderReason })
  @IsEnum(OrderReason)
  reason: OrderReason;
}

export class CompleteOrderDto {
  @ApiPropertyOptional({
    example: '0427',
    description: 'Gel-al siparişinde zorunlu: müşterinin gösterdiği 4 hane',
  })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'invalid' })
  pickupCode?: string;
}
```

`src/orders/cook-orders.service.ts` (durum kontrolü koddan önce: `ready` değilse 409, sonra kod; reddetmede `cancelledBy` yazılmaz — spec diyagramı yalnız iptal ve süre dolmasına atar):

```ts
import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { Order, OrderPatch } from './domain/order';
import { CompleteOrderDto } from './dto/cook-order-actions.dto';
import { ListCookOrdersQueryDto } from './dto/list-orders.dto';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { orderStatusConflict } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { estimatedMinutesFor, estimatedReadyAt } from './order-pricing';
import { OrderAction, canTransition } from './order-status';
import { istanbulDayStart, istanbulWeekStart } from './order-time';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';
import { cookOrderCard, cookOrderDetail } from './presenters';
import { CookOrderCard, CookOrderDetail, CookOrderSummary } from './views';

/** The cook's side: the kitchen's orders and every step after "new". */
@Injectable()
export class CookOrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly lifecycle: OrderLifecycleService,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async list(
    ownerId: User['id'],
    query: ListCookOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CookOrderCard>> {
    const kitchen = await this.kitchen(ownerId);
    const orders = await this.orderRepository.listForKitchen(
      kitchen.id,
      query.tab,
      istanbulDayStart(new Date()),
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    return infinityPagination(orders.map(cookOrderCard), {
      page: query.page,
      limit: query.limit,
    });
  }

  async summary(ownerId: User['id']): Promise<CookOrderSummary> {
    const kitchen = await this.kitchen(ownerId);
    const now = new Date();
    const [counts, today, week, hasEverCompleted] = await Promise.all([
      this.orderRepository.countByStatus(kitchen.id, [
        OrderStatus.pending,
        OrderStatus.accepted,
        OrderStatus.preparing,
        OrderStatus.ready,
        OrderStatus.onTheWay,
      ]),
      this.orderRepository.completedTotals(kitchen.id, istanbulDayStart(now)),
      this.orderRepository.completedTotals(kitchen.id, istanbulWeekStart(now)),
      this.orderRepository.hasCompleted(kitchen.id),
    ]);
    const count = (status: OrderStatus) => counts[status] ?? 0;

    return {
      counts: {
        new: count(OrderStatus.pending),
        preparing: count(OrderStatus.accepted) + count(OrderStatus.preparing),
        ready: count(OrderStatus.ready) + count(OrderStatus.onTheWay),
      },
      today,
      week,
      hasEverCompleted,
    };
  }

  async detail(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return cookOrderDetail(await this.order(ownerId, id));
  }

  /** Writes estimatedReadyAt: now + longest prep (+ buffer for delivery). */
  async accept(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);
    const now = new Date();
    const minutes = estimatedMinutesFor(
      order.items,
      order.fulfillment,
      this.configService.getOrThrow('orders.deliveryBufferMinutes', {
        infer: true,
      }),
    );

    return cookOrderDetail(
      await this.lifecycle.advance(
        order,
        'accept',
        { estimatedReadyAt: estimatedReadyAt(now, minutes) },
        now,
      ),
    );
  }

  reject(
    ownerId: User['id'],
    id: Order['id'],
    reason: OrderReason,
  ): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'reject', { reason });
  }

  start(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'start');
  }

  ready(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'ready');
  }

  dispatch(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'dispatch');
  }

  /** Pickup needs the customer's code (422 pickupCode); delivery does not. */
  async complete(
    ownerId: User['id'],
    id: Order['id'],
    dto: CompleteOrderDto,
  ): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);

    if (!canTransition(order.status, 'complete', order.fulfillment)) {
      throw orderStatusConflict();
    }

    if (order.fulfillment === Fulfillment.pickup) {
      const problem = !dto.pickupCode
        ? 'required'
        : dto.pickupCode !== order.pickupCode
          ? 'invalid'
          : null;

      if (problem) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { pickupCode: problem },
        });
      }
    }

    return cookOrderDetail(await this.lifecycle.advance(order, 'complete'));
  }

  cancel(
    ownerId: User['id'],
    id: Order['id'],
    reason: OrderReason,
  ): Promise<CookOrderDetail> {
    return this.step(ownerId, id, 'cookCancel', {
      cancelledBy: CancelledBy.cook,
      reason,
    });
  }

  private async step(
    ownerId: User['id'],
    id: Order['id'],
    action: OrderAction,
    patch: OrderPatch = {},
  ): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);
    return cookOrderDetail(await this.lifecycle.advance(order, action, patch));
  }

  /** The cook's kitchen (404 without one), with overdue orders already expired. */
  private async kitchen(ownerId: User['id']): Promise<Kitchen> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    await this.lifecycle.expireOverdue({ kitchenId: kitchen.id });
    return kitchen;
  }

  private async order(ownerId: User['id'], id: Order['id']): Promise<Order> {
    const kitchen = await this.kitchen(ownerId);
    return orNotFound(this.orderRepository.findForKitchen(kitchen.id, id));
  }
}
```

Run: `npx jest src/orders/cook-orders.service.spec.ts` → PASS (11 test).

- [ ] **Step 5: Controller ve modül**

`src/orders/cook-orders.controller.ts` (`summary` rotası `:id`'den önce):

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { CookOrdersService } from './cook-orders.service';
import { CompleteOrderDto, OrderReasonDto } from './dto/cook-order-actions.dto';
import { ListCookOrdersQueryDto } from './dto/list-orders.dto';
import { CookOrderCard, CookOrderDetail, CookOrderSummary } from './views';

/** The signed-in cook's incoming orders; no kitchen → 404. */
@ApiTags('Kitchen orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/orders',
  version: '1',
})
export class CookOrdersController {
  constructor(private readonly cookOrdersService: CookOrdersService) {}

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(CookOrderCard) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListCookOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CookOrderCard>> {
    return this.cookOrdersService.list(request.user.id, query);
  }

  // Before ':id' so "summary" is not taken for an order id.
  @Get('summary')
  @ApiOkResponse({ type: CookOrderSummary })
  summary(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<CookOrderSummary> {
    return this.cookOrdersService.summary(request.user.id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  detail(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.detail(request.user.id, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  accept(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.accept(request.user.id, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  reject(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.reject(request.user.id, id, dto.reason);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  start(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.start(request.user.id, id);
  }

  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  ready(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.ready(request.user.id, id);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  dispatch(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.dispatch(request.user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  complete(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteOrderDto,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.complete(request.user.id, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  cancel(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.cancel(request.user.id, id, dto.reason);
  }
}
```

`src/orders/orders.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { CookOrdersController } from './cook-orders.controller';
import { CookOrdersService } from './cook-orders.service';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderPersistenceModule,
    PaymentsModule,
    KitchensModule,
    ProductsModule,
    AddressesModule,
  ],
  controllers: [OrdersController, CookOrdersController],
  providers: [OrdersService, CookOrdersService, OrderLifecycleService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

Run: `npx tsc --noEmit -p tsconfig.json && npm test` → hata yok, PASS.

- [ ] **Step 6: e2e — aşçı blokları**

`test/user/orders.e2e-spec.ts` — dosyanın son `});` satırından **önce** ekle (sıra önemli: `done` sekmesi bu bloktaki kapanış sırasını bekler):

```ts
  const placed = async (body: Record<string, unknown>) =>
    (await placeOrder(body).expect(201)).body.data;

  const step = (id: string, action: string, body: object = {}) =>
    post(`/kitchens/me/orders/${id}/${action}`, cook).send(body);

  let orderB: string;
  let orderC: string;
  let orderD: string;
  let orderE: string;
  let orderG: string;

  describe('the cook’s side', () => {
    it('should show a new order to the cook without the pickup code or phone', async () => {
      const order = await placed({
        kitchenId,
        fulfillment: 'pickup',
        items: [{ productId: kofteId, quantity: 1 }],
        expectedTotalKurus: 9450,
      });
      orderB = order.id;

      await get('/kitchens/me/orders?tab=new', cook)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find(
            (o: { id: string }) => o.id === orderB,
          );
          expect(card).toMatchObject({
            code: order.code,
            customerName: 'Deniz A.',
            items: [{ name: 'Mercimek köftesi', quantity: 1 }],
            totalKurus: 9450,
          });
          expect(card).not.toHaveProperty('pickupCode');
        });

      await get(`/kitchens/me/orders/${orderB}`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            customerName: 'Deniz A.',
            subtotalKurus: 9000,
            serviceFeeKurus: 450,
          });
          expect(body.data).not.toHaveProperty('pickupCode');
          expect(JSON.stringify(body.data)).not.toContain(customerPhone);
        });
    });

    it('should 404 the cook endpoints for a user without a kitchen', () =>
      get('/kitchens/me/orders?tab=new', customer).expect(404));

    it('should keep another cook out of the order', async () => {
      const otherCook = await phoneLogin(uniquePhone('+90563'));
      await openKitchen(otherCook, northOf(HOME, 2));

      await get(`/kitchens/me/orders/${orderB}`, otherCook).expect(404);
      await post(`/kitchens/me/orders/${orderB}/accept`, otherCook).expect(404);
    });

    it('should require a known reason to reject', () =>
      step(orderB, 'reject', { reason: 'because' }).expect(422));

    it('should reject with a reason and give portions and money back', async () => {
      await step(orderB, 'reject', { reason: 'too_busy' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'rejected',
            reason: 'too_busy',
          });
        });

      expect(await portionsOf(kofteId)).toBe(5);

      await get(`/orders/${orderB}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'rejected',
            reason: 'too_busy',
            payment: { status: 'refunded' },
          });
        });
    });

    it('should walk a pickup order to completion with the pickup code', async () => {
      const order = await placed({
        kitchenId,
        fulfillment: 'pickup',
        items: [{ productId: mantiId, quantity: 1 }],
        expectedTotalKurus: 14700,
      });
      orderD = order.id;

      const { body: accepted } = await step(orderD, 'accept').expect(200);
      expect(accepted.data.status).toBe('accepted');
      expect(
        Date.parse(accepted.data.estimatedReadyAt) -
          Date.parse(accepted.data.acceptedAt),
      ).toBe(45 * 60_000);

      await get(`/orders/${orderD}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.kitchenAddress).toEqual({
            fullAddress: 'Deneme Mh. Test Sk. No:1',
            latitude: HOME.latitude,
            longitude: HOME.longitude,
          });
        });

      await post(`/orders/${orderD}/cancel`, customer).expect(409);
      await step(orderD, 'start').expect(200);
      await step(orderD, 'ready').expect(200);
      await step(orderD, 'dispatch').expect(409);

      await step(orderD, 'complete')
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'pickupCode', message: 'required' },
          ]);
        });

      const wrong = order.pickupCode === '0000' ? '1111' : '0000';
      await step(orderD, 'complete', { pickupCode: wrong })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'pickupCode', message: 'invalid' },
          ]);
        });

      await step(orderD, 'complete', { pickupCode: order.pickupCode })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.status).toBe('completed');
        });

      await get(`/orders/${orderD}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.kitchenAddress).toBeNull();
          expect(body.data.completedAt).toEqual(expect.any(String));
        });
    });

    it('should walk a delivery order through dispatch to completion', async () => {
      const order = await placed({
        kitchenId,
        fulfillment: 'delivery',
        addressId: nearId,
        items: [{ productId: mantiId, quantity: 1 }],
        expectedTotalKurus: 16200,
      });
      orderC = order.id;
      expect(order).toMatchObject({
        pickupCode: null,
        deliveryFeeKurus: 1500,
        deliveryAddress: { fullAddress: 'Teslimat Sk. No:5' },
      });

      await step(orderC, 'accept').expect(200);

      await get(`/orders/${orderC}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.kitchenAddress).toBeNull();
        });

      await get(`/kitchens/me/orders/${orderC}`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.deliveryAddress).toMatchObject({
            fullAddress: 'Teslimat Sk. No:5',
          });
        });

      for (const action of ['start', 'ready', 'dispatch']) {
        await step(orderC, action).expect(200);
      }

      await step(orderC, 'complete')
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.status).toBe('completed');
          expect(body.data.onTheWayAt).toEqual(expect.any(String));
        });
    });

    it('should let the cook cancel an accepted order with a reason', async () => {
      const order = await placed({
        kitchenId,
        fulfillment: 'delivery',
        addressId: nearId,
        items: [{ productId: kofteId, quantity: 1 }],
        expectedTotalKurus: 10950,
      });
      orderE = order.id;

      await step(orderE, 'accept').expect(200);
      expect(await portionsOf(kofteId)).toBe(4);

      await step(orderE, 'cancel').expect(422);
      await step(orderE, 'cancel', { reason: 'out_of_ingredients' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'cancelled',
            cancelledBy: 'cook',
            reason: 'out_of_ingredients',
          });
        });

      expect(await portionsOf(kofteId)).toBe(5);

      await get(`/orders/${orderE}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.payment).toEqual({ status: 'refunded' });
        });
    });

    it('should close an order whose product was deleted meanwhile', async () => {
      const sutlacId = await addProduct(cook, {
        categoryId: await categoryId(cook, 'dessert'),
        name: 'Fırın sütlaç',
        priceKurus: 6500,
        saleType: 'daily_portion',
        portionsAvailable: 3,
      });
      const order = await placed({
        kitchenId,
        fulfillment: 'pickup',
        items: [{ productId: sutlacId, quantity: 1 }],
        expectedTotalKurus: 6825,
      });
      orderG = order.id;

      await request(app)
        .delete(`/api/v1/kitchens/me/products/${sutlacId}`)
        .auth(cook, { type: 'bearer' })
        .expect(204);

      await step(orderG, 'reject', { reason: 'out_of_ingredients' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.status).toBe('rejected');
          expect(body.data.items[0].name).toBe('Fırın sütlaç');
        });
    });

    it('should sum up today and the week', () =>
      get('/kitchens/me/orders/summary', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({
            counts: { new: 0, preparing: 0, ready: 0 },
            today: { orders: 2, revenueKurus: 28000 },
            week: { orders: 2, revenueKurus: 28000 },
            hasEverCompleted: true,
          });
        }));

    it('should list today’s closed orders under done, newest first', () =>
      get('/kitchens/me/orders?tab=done', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).toEqual([
            orderG,
            orderE,
            orderC,
            orderD,
            orderB,
            orderA,
          ]);
        }));
  });
```

Run: `npm run test:e2e -- --runInBand test/user/orders.e2e-spec.ts`
Expected: PASS (29 test).

- [ ] **Step 7: Tüm paket ve commit**

```bash
npm test && npm run lint && npm run test:e2e -- --runInBand
git add src/orders test/user/orders.e2e-spec.ts
git commit -m "feat(orders): let cooks answer, prepare and hand over orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Kabul süresinin dolması (`@nestjs/schedule`)

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm install`), `src/app.module.ts`, `src/orders/orders.module.ts`, `test/user/orders.e2e-spec.ts`
- Create: `src/orders/orders-expiry.task.ts`
- Test: `src/orders/orders-expiry.task.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`OrderRepository.deleteRequestsBefore`), Task 5 (`OrderLifecycleService.expireOverdue` — okuma uçları bunu zaten çağırıyor), `testDatabase()` (Task 5).
- Produces: `OrdersExpiryTask.sweep(now?: Date): Promise<void>` — `@Interval(30_000)`; tüm süresi geçmiş `pending` siparişleri `expired` yapar (porsiyon + ödeme iadesi) ve 24 saatten eski `order_request` satırlarını siler; hata loglanır, üst üste binen tur atlanır. `ScheduleModule.forRoot()` `AppModule`'de.

- [ ] **Step 1: Bağımlılığı ekle**

```bash
npm install --save-exact @nestjs/schedule@6.1.3
```

(6.1.3 Nest 11 ve CommonJS ile çalışan son sürüm; 12.x yalnız ESM.) Kontrol: `package.json` dependencies'te `"@nestjs/schedule": "6.1.3"`.

- [ ] **Step 2: Tarama işi — test**

`src/orders/orders-expiry.task.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersExpiryTask } from './orders-expiry.task';

const NOW = new Date('2026-10-18T10:00:00Z');

const build = () => {
  const lifecycle = { expireOverdue: jest.fn().mockResolvedValue(2) };
  const repository = {
    deleteRequestsBefore: jest.fn().mockResolvedValue(undefined),
  };
  const task = new OrdersExpiryTask(
    lifecycle as unknown as OrderLifecycleService,
    repository as unknown as OrderRepository,
  );
  return { task, lifecycle, repository };
};

describe('OrdersExpiryTask', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('should expire every overdue order and forget day-old request keys', async () => {
    const { task, lifecycle, repository } = build();

    await task.sweep(NOW);

    expect(lifecycle.expireOverdue).toHaveBeenCalledWith({}, NOW);
    expect(repository.deleteRequestsBefore).toHaveBeenCalledWith(
      new Date('2026-10-17T10:00:00Z'),
    );
  });

  it('should log a failed pass and keep running', async () => {
    const { task, lifecycle, repository } = build();
    lifecycle.expireOverdue.mockRejectedValueOnce(new Error('db down'));

    await expect(task.sweep(NOW)).resolves.toBeUndefined();
    expect(repository.deleteRequestsBefore).not.toHaveBeenCalled();

    await task.sweep(NOW);
    expect(repository.deleteRequestsBefore).toHaveBeenCalledTimes(1);
  });

  it('should skip a tick while the previous pass is still running', async () => {
    const { task, lifecycle } = build();
    let finish: (count: number) => void = () => undefined;
    lifecycle.expireOverdue.mockImplementationOnce(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );

    const first = task.sweep(NOW);
    await task.sweep(NOW);
    finish(0);
    await first;

    expect(lifecycle.expireOverdue).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx jest src/orders/orders-expiry.task.spec.ts` → FAIL (modül yok).

- [ ] **Step 3: Tarama işi — kod**

`src/orders/orders-expiry.task.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';

const SWEEP_MS = 30_000;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Every 30 s: expires pending orders nobody answered (portions and money go
 * back) and forgets Idempotency-Keys older than a day. Reads expire their
 * own orders too, so the sweep's delay never shows on screen.
 */
@Injectable()
export class OrdersExpiryTask {
  private readonly logger = new Logger(OrdersExpiryTask.name);
  private running = false;

  constructor(
    private readonly lifecycle: OrderLifecycleService,
    private readonly orderRepository: OrderRepository,
  ) {}

  @Interval(SWEEP_MS)
  async sweep(now: Date = new Date()): Promise<void> {
    // A slow pass must not overlap the next tick.
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const expired = await this.lifecycle.expireOverdue({}, now);

      if (expired > 0) {
        this.logger.log(`Expired ${expired} unanswered order(s)`);
      }

      await this.orderRepository.deleteRequestsBefore(
        new Date(now.getTime() - REQUEST_TTL_MS),
      );
    } catch (error) {
      this.logger.error(
        `Order sweep failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
```

`src/orders/orders.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { CookOrdersController } from './cook-orders.controller';
import { CookOrdersService } from './cook-orders.service';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersController } from './orders.controller';
import { OrdersExpiryTask } from './orders-expiry.task';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderPersistenceModule,
    PaymentsModule,
    KitchensModule,
    ProductsModule,
    AddressesModule,
  ],
  controllers: [OrdersController, CookOrdersController],
  providers: [
    OrdersService,
    CookOrdersService,
    OrderLifecycleService,
    OrdersExpiryTask,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
```

`src/app.module.ts` — `import { ConfigModule, ConfigService } from '@nestjs/config';` satırının altına `import { ScheduleModule } from '@nestjs/schedule';` ekle; `imports` dizisinde `infrastructureDatabaseModule,` satırının altına `ScheduleModule.forRoot(),` ekle.

Run: `npx jest src/orders/orders-expiry.task.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (3 test), tip hatası yok. Dev API yeniden başlayınca hata logu olmamalı.

- [ ] **Step 4: e2e — okuma anında süre dolması**

`test/user/orders.e2e-spec.ts` — `@jest/globals` importunu `import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';` yap, `../utils/orders` importuna `testDatabase,` ekle (alfabetik: `setName,`'den sonra) ve dosyanın son `});` satırından **önce** ekle (3 dakika beklemek yerine `expiresAt` doğrudan SQL ile geçmişe alınır):

```ts
  describe('expiry', () => {
    const db = testDatabase();

    beforeAll(async () => {
      await db.initialize();
    });

    afterAll(async () => {
      await db.destroy();
    });

    it('should expire an unanswered order on the next read and give everything back', async () => {
      const order = await placed({
        kitchenId,
        fulfillment: 'pickup',
        items: [{ productId: kofteId, quantity: 2 }],
        expectedTotalKurus: 18900,
      });
      expect(await portionsOf(kofteId)).toBe(3);

      // Three minutes are too long for a test: move the deadline instead.
      await db.query(
        `UPDATE "order" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
        [order.id],
      );

      await get('/kitchens/me/orders?tab=new', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).not.toContain(order.id);
        });

      await get(`/orders/${order.id}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'expired',
            cancelledBy: 'system',
            reason: null,
            payment: { status: 'refunded' },
          });
        });

      expect(await portionsOf(kofteId)).toBe(5);
    });
  });
```

Run: `npm run test:e2e -- --runInBand test/user/orders.e2e-spec.ts`
Expected: PASS (30 test).

- [ ] **Step 5: Taramayı elle doğrula**

Dev API çalışırken bir sipariş ver ve 3 dakika + en fazla 30 sn bekle (ya da e2e'deki gibi `expiresAt`'i SQL ile geçmişe al ve hiçbir uca dokunmadan 30 sn bekle):

```bash
PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2-) psql -h localhost -U sofram -d sofram -c "SELECT code, status, \"cancelledBy\" FROM \"order\" ORDER BY \"createdAt\" DESC LIMIT 3"
```

Expected: süresi geçen sipariş `expired`, `cancelledBy = system`; dev API logunda `Expired 1 unanswered order(s)`.

- [ ] **Step 6: Commit**

```bash
npm test && npm run lint
git add package.json package-lock.json src/app.module.ts src/orders test/user/orders.e2e-spec.ts
git commit -m "feat(orders): expire unanswered orders every 30 seconds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hesap silme, geliştirme seed'i, belgeler, son doğrulama

**Files:**
- Modify: `src/users/users.service.ts`, `src/users/users.module.ts`, `src/users/users.service.spec.ts`
- Modify: `src/database/seeds/relational/kitchen/kitchen-seed.service.ts`, `src/database/seeds/relational/seed.module.ts`, `src/database/seeds/relational/run-seed.ts`
- Create: `src/database/seeds/relational/order/order-seed.module.ts`, `src/database/seeds/relational/order/order-seed.service.ts`
- Modify: `test/user/orders.e2e-spec.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 5 (`OrdersService.assertNoActiveOrders`, `OrdersService.clearDeliveryAddresses`), Task 1 (`generateOrderCode`, `generatePickupCode`, `estimatedMinutesFor`, `estimatedReadyAt`, `ROLLBACK_STATUSES`), entity'ler (Task 3), `deliveryFeeFor`, `haversineKm`, `roundCoord`, `roundDistance`.
- Produces: `UsersService.remove` sırası **409 kontrolü → anonimleştirme → sipariş adresleri → ürünler → mutfak → adresler → oturumlar**; `UsersModule` `OrdersModule`'ü import eder (döngü yok: `OrdersModule` `UsersModule`'e bağlı değil, isimler join'le okunur). `OrderSeedService.run(): Promise<void>` (yalnız production dışı).

- [ ] **Step 1: Hesap silme — test**

`src/users/users.service.spec.ts` — dosyanın tamamı:

```ts
import { ConflictException } from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { SessionService } from '../session/session.service';
import { User } from './domain/user';
import { UserRepository } from './infrastructure/persistence/user.repository';
import { UsersService } from './users.service';

const aUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), { id: 7, ...overrides });

const buildUsersService = () => {
  const repository = {
    findById: jest.fn(),
    findByEmail: jest.fn().mockResolvedValue(null),
    findByPhoneNumber: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((data) => aUser(data)),
    update: jest.fn().mockImplementation((id, data) => aUser({ id, ...data })),
    anonymizeAndSoftDelete: jest.fn(),
  };
  const addresses = { removeAllForUser: jest.fn() };
  const sessions = { deleteByUserId: jest.fn() };
  const products = { removeAllForOwner: jest.fn() };
  const kitchens = { removeForOwner: jest.fn() };
  const orders = {
    assertNoActiveOrders: jest.fn().mockResolvedValue(undefined),
    clearDeliveryAddresses: jest.fn(),
  };

  const service = new UsersService(
    repository as unknown as UserRepository,
    {} as FilesService,
    addresses as unknown as AddressesService,
    sessions as unknown as SessionService,
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
    orders as unknown as OrdersService,
  );

  return {
    service,
    repository,
    addresses,
    sessions,
    kitchens,
    products,
    orders,
  };
};

describe('UsersService.remove', () => {
  it('should anonymize the user, then remove order addresses, the menu, kitchen, addresses and sessions', async () => {
    const {
      service,
      repository,
      addresses,
      sessions,
      kitchens,
      products,
      orders,
    } = buildUsersService();

    await service.remove(7);

    expect(orders.assertNoActiveOrders).toHaveBeenCalledWith(7);
    expect(repository.anonymizeAndSoftDelete).toHaveBeenCalledWith(7);
    expect(orders.clearDeliveryAddresses).toHaveBeenCalledWith(7);
    expect(products.removeAllForOwner).toHaveBeenCalledWith(7);
    expect(kitchens.removeForOwner).toHaveBeenCalledWith(7);
    expect(addresses.removeAllForUser).toHaveBeenCalledWith(7);
    expect(sessions.deleteByUserId).toHaveBeenCalledWith({ userId: 7 });

    const order = [
      orders.assertNoActiveOrders,
      repository.anonymizeAndSoftDelete,
      orders.clearDeliveryAddresses,
      products.removeAllForOwner,
      kitchens.removeForOwner,
      addresses.removeAllForUser,
      sessions.deleteByUserId,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('UsersService.remove with open orders', () => {
  it('should refuse before touching anything', async () => {
    const { service, repository, orders } = buildUsersService();
    orders.assertNoActiveOrders.mockRejectedValue(
      new ConflictException({ status: 409, error: 'activeOrdersExist' }),
    );

    await expect(service.remove(7)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.anonymizeAndSoftDelete).not.toHaveBeenCalled();
  });
});

describe('UsersService phone number uniqueness', () => {
  it('should refuse to create a user with a taken phone number', async () => {
    const { service, repository } = buildUsersService();
    repository.findByPhoneNumber.mockResolvedValue(aUser({ id: 3 }));

    await expect(
      service.create({
        phoneNumber: '+905551112233',
        email: null,
        firstName: null,
        lastName: null,
      }),
    ).rejects.toMatchObject({
      response: { errors: { phoneNumber: 'phoneAlreadyExists' } },
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("should refuse to move a user onto someone else's phone number", async () => {
    const { service, repository } = buildUsersService();
    repository.findByPhoneNumber.mockResolvedValue(aUser({ id: 3 }));

    await expect(
      service.update('7', { phoneNumber: '+905551112233' }),
    ).rejects.toMatchObject({
      response: { errors: { phoneNumber: 'phoneAlreadyExists' } },
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('should let a user keep their own phone number (route id is a string)', async () => {
    const { service, repository } = buildUsersService();
    repository.findByPhoneNumber.mockResolvedValue(aUser({ id: 7 }));

    await service.update('7', { phoneNumber: '+905551112233' });

    expect(repository.update).toHaveBeenCalledWith(
      '7',
      expect.objectContaining({ phoneNumber: '+905551112233' }),
    );
  });
});
```

Run: `npx jest src/users/users.service.spec.ts` → FAIL (`UsersService` yedinci bağımlılığı tanımıyor, sıra ve 409 testleri kırmızı).

- [ ] **Step 2: Hesap silme — kod**

`src/users/users.service.ts` — `import { ProductsService } …` satırının altına:

```ts
import { OrdersService } from '../orders/orders.service';
```

Constructor'da `private readonly productsService: ProductsService,` satırının altına:

```ts
    private readonly ordersService: OrdersService,
```

`remove` metodunu ve üstündeki yorumu şununla değiştir:

```ts
  /**
   * The only account-deletion path (DELETE /auth/me and admin
   * DELETE /users/:id). Refused (409 activeOrdersExist) while an order is
   * open as customer or cook. Then: anonymize + soft delete the user in one
   * UPDATE, clear the delivery-address copies on their orders, take the menu
   * and kitchen off discovery, hard-delete their addresses (GPS) and end
   * every session, which also revokes outstanding access tokens (see
   * JwtStrategy).
   */
  async remove(id: User['id']): Promise<void> {
    await this.ordersService.assertNoActiveOrders(id);
    await this.usersRepository.anonymizeAndSoftDelete(id);
    await this.ordersService.clearDeliveryAddresses(id);
    await this.productsService.removeAllForOwner(id);
    await this.kitchensService.removeForOwner(id);
    await this.addressesService.removeAllForUser(id);
    await this.sessionService.deleteByUserId({ userId: id });
  }
```

`src/users/users.module.ts` — `import { ProductsModule } …` satırının altına `import { OrdersModule } from '../orders/orders.module';`, `imports` dizisinde `ProductsModule,`'ten sonra `OrdersModule,` ekle.

Run: `npx jest src/users && npx tsc --noEmit -p tsconfig.json` → PASS, tip hatası yok.

- [ ] **Step 3: e2e — hesap silme bloğu**

`test/user/orders.e2e-spec.ts` — dosyanın son `});` satırından **önce** ekle (dosyanın son bloğu kalmalı: müşteri ve aşçı hesabı silinir):

```ts
  describe('account deletion', () => {
    const deleteAccount = (token: string) =>
      request(app).delete('/api/v1/auth/me').auth(token, { type: 'bearer' });

    it('should wait for open orders on either side, then scrub the delivery address', async () => {
      const order = await placed({
        kitchenId,
        fulfillment: 'delivery',
        addressId: nearId,
        items: [{ productId: mantiId, quantity: 1 }],
        expectedTotalKurus: 16200,
      });

      await deleteAccount(customer)
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('activeOrdersExist');
        });
      await deleteAccount(cook).expect(409);

      await step(order.id, 'reject', { reason: 'other' }).expect(200);
      await deleteAccount(customer).expect(204);

      await get(`/kitchens/me/orders/${order.id}`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'rejected',
            deliveryAddress: null,
            customerName: null,
          });
        });

      // Earlier, completed delivery orders lose the copy too.
      await get(`/kitchens/me/orders/${orderC}`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.deliveryAddress).toBeNull();
        });

      await deleteAccount(cook).expect(204);
    });
  });
```

Run: `npm run test:e2e -- --runInBand test/user/orders.e2e-spec.ts`
Expected: PASS (31 test).

- [ ] **Step 4: Geliştirme seed'i**

`src/database/seeds/relational/kitchen/kitchen-seed.service.ts` — `SeedKitchen` tipinde `deliveryEnabled: boolean;` altına:

```ts
  freeDeliveryMinKurus: number | null;
  minOrderKurus: number | null;
```

`KITCHENS` dizisinde her mutfağın `deliveryEnabled` satırının altına sırayla ekle — Ayşe Teyze (`+905550000101`): `freeDeliveryMinKurus: 30000, minOrderKurus: null,`; Nuran Hanım (`+905550000102`): `freeDeliveryMinKurus: null, minOrderKurus: null,`; Hatice Teyze (`+905550000103`): `freeDeliveryMinKurus: null, minOrderKurus: 15000,` (her alan kendi satırında). `run()` içindeki `this.kitchens.create({...})` çağrısında `freeDeliveryMinKurus: 30000,` satırını şununla değiştir:

```ts
          freeDeliveryMinKurus: seed.freeDeliveryMinKurus,
          minOrderKurus: seed.minOrderKurus,
```

`src/database/seeds/relational/order/order-seed.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressEntity } from '../../../../addresses/infrastructure/persistence/relational/entities/address.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderItemEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { PaymentEntity } from '../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { OrderSeedService } from './order-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      AddressEntity,
      KitchenEntity,
      ProductEntity,
      OrderEntity,
      OrderItemEntity,
      PaymentEntity,
    ]),
  ],
  providers: [OrderSeedService],
  exports: [OrderSeedService],
})
export class OrderSeedModule {}
```

`src/database/seeds/relational/order/order-seed.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressEntity } from '../../../../addresses/infrastructure/persistence/relational/entities/address.entity';
import { AuthProvidersEnum } from '../../../../auth/auth-providers.enum';
import { deliveryFeeFor } from '../../../../catalog/delivery';
import {
  haversineKm,
  roundCoord,
  roundDistance,
} from '../../../../catalog/geo';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import {
  generateOrderCode,
  generatePickupCode,
} from '../../../../orders/order-codes';
import {
  estimatedMinutesFor,
  estimatedReadyAt,
} from '../../../../orders/order-pricing';
import { ROLLBACK_STATUSES } from '../../../../orders/order-status';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from '../../../../orders/order.enums';
import { OrderItemEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { PaymentStatus } from '../../../../payments/domain/payment';
import { PaymentEntity } from '../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';

const COOK_PHONE = '+905550000101';

const CUSTOMER = {
  phoneNumber: '+905550000201',
  firstName: 'Deniz',
  lastName: 'Arslan',
};

const ADDRESS = {
  title: 'Ev',
  fullAddress: 'Osmanağa Mh. Söğütlüçeşme Cd. No:30 D:4',
  district: 'Kadıköy',
  neighborhood: 'Osmanağa',
  buildingNo: '30',
  floor: '2',
  apartmentNo: '4',
  directions: 'Eczanenin üstü',
  latitude: 40.9905,
  longitude: 29.0282,
};

// The defaults of ORDER_SERVICE_FEE_PERCENT, ORDER_DELIVERY_BUFFER_MINUTES and
// DISCOVERY_COORD_PRECISION; the seed runs without the app's config.
const SERVICE_FEE_PERCENT = 5;
const DELIVERY_BUFFER_MINUTES = 15;
const COORD_PRECISION = 3;
const MINUTE_MS = 60_000;

type SeedOrder = {
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** [product name, quantity] from the first seed kitchen's menu. */
  items: [string, number][];
  minutesAgo: number;
  cancelledBy?: CancelledBy;
  reason?: OrderReason;
};

/** One order per status except pending (it would expire within minutes). */
const ORDERS: SeedOrder[] = [
  {
    status: OrderStatus.accepted,
    fulfillment: Fulfillment.pickup,
    items: [['Ev usulü mantı', 1]],
    minutesAgo: 10,
  },
  {
    status: OrderStatus.preparing,
    fulfillment: Fulfillment.delivery,
    items: [['Karnıyarık', 2]],
    minutesAgo: 25,
  },
  {
    status: OrderStatus.ready,
    fulfillment: Fulfillment.pickup,
    items: [
      ['Mercimek çorbası', 2],
      ['Fırın sütlaç', 1],
    ],
    minutesAgo: 40,
  },
  {
    status: OrderStatus.onTheWay,
    fulfillment: Fulfillment.delivery,
    items: [
      ['Ev usulü mantı', 2],
      ['Fırın sütlaç', 2],
    ],
    minutesAgo: 55,
  },
  {
    status: OrderStatus.completed,
    fulfillment: Fulfillment.pickup,
    items: [['Karnıyarık', 1]],
    minutesAgo: 120,
  },
  {
    status: OrderStatus.rejected,
    fulfillment: Fulfillment.delivery,
    items: [['Mercimek çorbası', 1]],
    minutesAgo: 180,
    reason: OrderReason.tooBusy,
  },
  {
    status: OrderStatus.cancelled,
    fulfillment: Fulfillment.pickup,
    items: [['Fırın sütlaç', 1]],
    minutesAgo: 240,
    cancelledBy: CancelledBy.customer,
  },
  {
    status: OrderStatus.expired,
    fulfillment: Fulfillment.delivery,
    items: [['Ev usulü mantı', 1]],
    minutesAgo: 300,
    cancelledBy: CancelledBy.system,
  },
];

/** Minutes after creation each step happened, in order. */
const STEPS = [
  ['acceptedAt', 2],
  ['preparingAt', 5],
  ['readyAt', 30],
  ['onTheWayAt', 35],
  ['completedAt', 45],
] as const;

/** How many STEPS an order in this status went through. */
const STEPS_TAKEN: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.accepted]: 1,
  [OrderStatus.preparing]: 2,
  [OrderStatus.ready]: 3,
  [OrderStatus.onTheWay]: 4,
  [OrderStatus.completed]: 5,
};

/**
 * Development data only: a customer (`dev:+905550000201`) with an order in
 * every status but pending at the first seed kitchen (`dev:+905550000101`).
 * Portions are not taken (these are history), payments are `dev`.
 */
@Injectable()
export class OrderSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(AddressEntity)
    private readonly addresses: Repository<AddressEntity>,
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly items: Repository<OrderItemEntity>,
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
  ) {}

  async run() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const cook = await this.users.findOne({
      where: { phoneNumber: COOK_PHONE },
    });
    const kitchen = cook
      ? await this.kitchens.findOne({ where: { ownerId: cook.id } })
      : null;

    if (
      !kitchen ||
      (await this.orders.exists({ where: { kitchenId: kitchen.id } }))
    ) {
      return;
    }

    const customer = await this.customer();
    const menu = new Map(
      (await this.products.find({ where: { kitchenId: kitchen.id } })).map(
        (product) => [product.name, product],
      ),
    );

    for (const seed of ORDERS) {
      await this.order(seed, kitchen, customer, menu);
    }
  }

  private async customer(): Promise<UserEntity> {
    const existing = await this.users.findOne({
      where: { phoneNumber: CUSTOMER.phoneNumber },
    });
    const customer =
      existing ??
      (await this.users.save(
        this.users.create({
          ...CUSTOMER,
          email: null,
          provider: AuthProvidersEnum.phone,
          kvkkAcceptedAt: new Date(),
          role: { id: RoleEnum.user },
          status: { id: StatusEnum.active },
        }),
      ));

    if (
      !(await this.addresses.exists({ where: { user: { id: customer.id } } }))
    ) {
      await this.addresses.save(
        this.addresses.create({ ...ADDRESS, isDefault: true, user: customer }),
      );
    }

    return customer;
  }

  private async order(
    seed: SeedOrder,
    kitchen: KitchenEntity,
    customer: UserEntity,
    menu: Map<string, ProductEntity>,
  ): Promise<void> {
    const createdAt = new Date(Date.now() - seed.minutesAgo * MINUTE_MS);
    const at = (minutes: number) =>
      new Date(createdAt.getTime() + minutes * MINUTE_MS);
    const lines = seed.items.map(([name, quantity], position) => ({
      product: menu.get(name) as ProductEntity,
      quantity,
      position,
    }));
    const subtotalKurus = lines.reduce(
      (sum, line) => sum + line.product.priceKurus * line.quantity,
      0,
    );
    const isDelivery = seed.fulfillment === Fulfillment.delivery;
    const distanceKm = haversineKm(ADDRESS, {
      latitude: roundCoord(kitchen.latitude, COORD_PRECISION),
      longitude: roundCoord(kitchen.longitude, COORD_PRECISION),
    });
    const freeDelivery =
      kitchen.freeDeliveryMinKurus !== null &&
      subtotalKurus >= kitchen.freeDeliveryMinKurus;
    const deliveryFeeKurus =
      isDelivery && !freeDelivery
        ? (deliveryFeeFor(kitchen.deliveryTiers, distanceKm) ?? 0)
        : 0;
    const serviceFeeKurus = Math.round(
      (subtotalKurus * SERVICE_FEE_PERCENT) / 100,
    );
    const totalKurus = subtotalKurus + deliveryFeeKurus + serviceFeeKurus;
    const stamps: Partial<Record<(typeof STEPS)[number][0], Date>> =
      Object.fromEntries(
        STEPS.slice(0, STEPS_TAKEN[seed.status] ?? 0)
          .filter(([step]) => isDelivery || step !== 'onTheWayAt')
          .map(([step, minutes]) => [step, at(minutes)]),
      );
    const closed = ROLLBACK_STATUSES.includes(seed.status);

    const order = await this.orders.save(
      this.orders.create({
        code: generateOrderCode(),
        customerId: customer.id,
        kitchenId: kitchen.id,
        status: seed.status,
        fulfillment: seed.fulfillment,
        deliveryAddress: isDelivery
          ? {
              fullAddress: ADDRESS.fullAddress,
              district: ADDRESS.district,
              neighborhood: ADDRESS.neighborhood,
              buildingNo: ADDRESS.buildingNo,
              floor: ADDRESS.floor,
              apartmentNo: ADDRESS.apartmentNo,
              directions: ADDRESS.directions,
              latitude: ADDRESS.latitude,
              longitude: ADDRESS.longitude,
            }
          : null,
        distanceKm: isDelivery ? roundDistance(distanceKm) : null,
        note: null,
        subtotalKurus,
        deliveryFeeKurus,
        serviceFeeKurus,
        totalKurus,
        pickupCode: isDelivery ? null : generatePickupCode(),
        expiresAt: at(3),
        estimatedReadyAt: stamps.acceptedAt
          ? estimatedReadyAt(
              stamps.acceptedAt,
              estimatedMinutesFor(
                lines.map((line) => line.product),
                seed.fulfillment,
                DELIVERY_BUFFER_MINUTES,
              ),
            )
          : null,
        acceptedAt: stamps.acceptedAt ?? null,
        preparingAt: stamps.preparingAt ?? null,
        readyAt: stamps.readyAt ?? null,
        onTheWayAt: stamps.onTheWayAt ?? null,
        completedAt: stamps.completedAt ?? null,
        closedAt: closed ? at(3) : null,
        cancelledBy: seed.cancelledBy ?? null,
        reason: seed.reason ?? null,
        createdAt,
      }),
    );

    await this.items.save(
      lines.map(({ product, quantity, position }) =>
        this.items.create({
          orderId: order.id,
          productId: product.id,
          position,
          name: product.name,
          unitPriceKurus: product.priceKurus,
          saleType: product.saleType,
          prepMinutes: product.prepMinutes,
          photo: product.photos[0] ?? null,
          quantity,
          note: null,
        }),
      ),
    );

    await this.payments.save(
      this.payments.create({
        orderId: order.id,
        provider: 'dev',
        providerRef: `dev_seed_${order.code}`,
        amountKurus: totalKurus,
        status: closed ? PaymentStatus.refunded : PaymentStatus.paid,
        paidAt: createdAt,
        refundedAt: closed ? at(3) : null,
      }),
    );
  }
}
```

`src/database/seeds/relational/seed.module.ts` — `import { KitchenSeedModule } …` altına `import { OrderSeedModule } from './order/order-seed.module';`, `imports` dizisinde `KitchenSeedModule,`'den sonra `OrderSeedModule,` ekle.

`src/database/seeds/relational/run-seed.ts` — `import { KitchenSeedService } …` altına `import { OrderSeedService } from './order/order-seed.service';`, `await app.get(KitchenSeedService).run();` altına `await app.get(OrderSeedService).run();` ekle.

Run: `npx tsc --noEmit -p tsconfig.json && npm run seed:run:relational`
Expected: hatasız biter. Mevcut dev veritabanında seed mutfakları zaten var (mutfak seed'i yalnız ekler, `minOrderKurus` değerleri yeni kurulumda gelir); sipariş seed'i ilk mutfakta sipariş yoksa çalışır.

```bash
PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2-) psql -h localhost -U sofram -d sofram -c "SELECT o.status, o.fulfillment, o.\"totalKurus\", p.status AS payment FROM \"order\" o JOIN payment p ON p.\"orderId\" = o.id JOIN kitchen k ON k.id = o.\"kitchenId\" JOIN \"user\" u ON u.id = k.\"ownerId\" WHERE u.\"phoneNumber\" = '+905550000101' ORDER BY o.\"createdAt\" DESC"
```

Expected: 8 satır — `accepted`, `preparing`, `ready`, `on_the_way` (delivery), `completed` `paid`; `rejected`, `cancelled`, `expired` `refunded`. İkinci `npm run seed:run:relational` yeni satır eklemez.

- [ ] **Step 5: `CLAUDE.md`**

API conventions'ta hesap silme maddesini şununla değiştir:

```markdown
- Account deletion (`DELETE /auth/me`, admin `DELETE /users/:id`) goes only through `UsersService.remove`. It is refused with 409 `activeOrdersExist` while the user has an open order as customer or as cook (overdue pending orders are expired first). Then one UPDATE anonymizes the user (phone → `deleted:<id>`, email/names/photo/socialId → null, `allergenPreferences` cleared) and soft-deletes it, the `deliveryAddress` copies on their orders are cleared, the user's products are soft-deleted and the kitchen is scrubbed (name, description, cover, address, coordinates, search text) and soft-deleted in one UPDATE — it is a copy of a hard-deleted address (so the menu and kitchen disappear from `/discover/*`), then addresses are hard-deleted and sessions ended — in that order: anonymize → order addresses → products → kitchen → addresses → sessions. Closed orders stay (anonymized parties). `JwtStrategy` checks the session on every request, so logout and deletion revoke access tokens immediately.
```

Son madde (`Dev seed …`) yerine şu maddeleri koy:

```markdown
- Orders (Faz 3): customers use `/orders` (`POST /orders/quote`, `POST /orders` with an `Idempotency-Key` uuid header, `GET /orders?scope=active|past`, `GET /orders/:id`, `POST /orders/:id/cancel`); cooks use `/kitchens/me/orders` (`?tab=new|preparing|ready|done`, `/summary`, `/:id`, `/:id/accept|reject|start|ready|dispatch|complete|cancel`). Prices and eligibility come from one pure function, `orders/order-pricing.ts` `quoteOrder`, for both quote and order. Every status change goes through `OrderLifecycleService.advance` (transition table in `orders/order-status.ts`): a status-guarded `UPDATE … WHERE status IN (…)`, 0 rows → 409 `orderStatusConflict`. Rejected/cancelled/expired orders put daily portions back (skipping deleted products) in the same transaction, then refund (`refund_failed` is stored and logged, never thrown). Placing an order is one transaction: order + items + idempotency key, conditional portion decrement, charge, payment row; a declined charge is 402 `paymentFailed` and nothing is kept. A changed total is 409 `orderTotalChanged` with `data.quote` — `AllExceptionsFilter` passes a client error's `data` through.
- Order privacy: the cook sees the customer as "Ad S." and the delivery address, never the phone or the pickup code; the customer gets the kitchen's exact address only for pickup orders in `accepted`, `preparing` or `ready`.
- Payments sit behind `payments/provider/PaymentProvider`; only `DevPaymentProvider` exists (`PAYMENT_PROVIDER=dev`). `DEV_PAYMENT_FAIL=true` declines every charge (ignored in production). `test/user/order-payment.e2e-spec.ts` runs only against an API started with that flag.
- Pending orders expire after `ORDER_ACCEPT_MINUTES` (3): `OrdersExpiryTask` sweeps every 30 s (`@nestjs/schedule`) and also deletes `order_request` rows older than 24 h; every order read expires its own overdue orders first. Service fee is `ORDER_SERVICE_FEE_PERCENT` (5) of the subtotal, delivery orders add `ORDER_DELIVERY_BUFFER_MINUTES` (15) to the estimate. Order times are `timestamptz`; "today"/"this week" are Istanbul (`orders/order-time.ts`).
- Dev seed (`npm run seed:run:relational`) adds categories everywhere and, outside production, three Kadıköy kitchens whose cooks log in with `dev:+905550000101..103` (the third has a ₺150 minimum, the first free delivery from ₺300), and a customer `dev:+905550000201` with one order in every status but pending at the first kitchen.
```

- [ ] **Step 6: Son doğrulama**

```bash
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
npm run test:e2e -- --runInBand
```

Expected: lint temiz, tip hatası yok, birim ve e2e PASS (`order-payment` dosyası atlanır). Ardından Task 5 Step 13'teki komutlarla `DEV_PAYMENT_FAIL=true` API'sine karşı `test/user/order-payment.e2e-spec.ts` → 1 PASS; 3002'deki süreci kapat.

Swagger'da (`http://localhost:3001/docs`) `Orders` ve `Kitchen orders` etiketleri, `POST /orders`'da `Idempotency-Key` başlığı görünür.

- [ ] **Step 7: Commit**

```bash
git add src/users src/database/seeds test/user/orders.e2e-spec.ts CLAUDE.md
git commit -m "feat(users): keep accounts with open orders; seed dev orders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Uygulama notları (plan yazılırken verilen kararlar — spec'i bu noktalarda netleştirir)

| Spec'teki | Uygulanan | Neden |
|---|---|---|
| Görev önerisi: ödeme → `minOrderKurus` → tablolar | `minOrderKurus` → dört tablo (ödeme dahil) → ödeme davranışı | `payment.orderId` `order`'a FK; tablo aynı migration'da olmalı. `quoteOrder` `QuoteKitchen` tipiyle `Kitchen`'dan bağımsız. |
| `order_item`, `order_request` ayrı entity | Generator'la üretilir, entity dosyaları `src/orders/…/entities/`'e taşınır, iskelet modülleri silinir | İkisini yalnız sipariş modülü okur/yazar; ayrı controller/CRUD servisi gereksiz. |
| `order_item` alanları | + `position` (int, sepet sırası) | Tek INSERT'le eklenen satırların okuma sırası tanımsız; detay ve kart sepet sırasını korur. |
| `distanceKm numeric` | `double precision` | `pg` `numeric`'i string döndürür; mutfak koordinatları ve `deliveryRadiusKm` ile aynı tip. |
| Durum, teslim tipi, `cancelledBy`, sebep, `payment.status` "enum" | `varchar` + TypeScript enum (DTO'da `@IsEnum`) | Faz 2 `saleType` emsali; Postgres enum'u her değer eklemede migration ister. |
| `quoteOrder(kitchen, products, items, fulfillment, address, now, config)` | `quoteOrder(input: QuoteInput)` (aynı alanlar + `customerId`) | `own_kitchen` için müşteri gerekir; sekiz konumsal argüman yerine tek nesne. |
| Teklifte "404 mutfak görünür değil" | 404 = mutfak yok ya da silinmiş; mesafe yalnız teslimatta `out_of_range` olarak bakılır | Gel-al için müşteri noktası yok; Faz 2 görünürlüğü noktaya bağlı. Mesafe Faz 2 §8 gereği yuvarlanmış mutfak noktasından. |
| Issue `unavailable`: yok/silinmiş/satışta değil/başka mutfağın | + kategorisi pasif ürün | Keşifte de listelenmiyor (`isProductListed`). |
| Ara toplam "istenen tüm kalemler" | Bulunan her ürünün fiyatı (sorunlu da olsa) girer; hiç bulunmayan ürün 0 | Fiyatı bilinmeyen ürün toplanamaz. |
| `freeDeliveryRemainingKurus` "eşik varsa ve altındaysa" | Yalnız `delivery` teklifinde | Gel-alda teslimat ücreti yok; "Ücretsiz teslimata ₺40 kaldı" yanıltıcı olur. |
| 422 alan eşlemesi | `kitchen_closed`, `below_minimum`, `own_kitchen` → `kitchenId`; `fulfillment_unavailable` → `fulfillment`; `out_of_range` → `addressId`; aynı alana düşen birden çok mesaj `", "` ile birleşir | Spec dört alan sayar; `below_minimum` mutfağın kuralı. Birleştirme ValidationPipe'ın davranışıyla aynı. |
| — | Aynı ürün iki kalemde → 422 (`ArrayUnique`) | Sepet ürün başına tek satır; porsiyon kontrolü ürün başına toplamla uğraşmaz. |
| — | Teklif ile sipariş arasında son porsiyon kapılırsa 422 `items.N.productId: insufficient_portions` | Koşullu düşüm 0 satır etkiler; müşteri sepeti düzeltir. |
| `Idempotency-Key` zorunlu | Eksik/uuid değil → 422 `idempotencyKey: mustBeUuid`; eşzamanlı aynı anahtar `order_request` unique ihlaliyle ödemeden önce durur, ilk sipariş 200 döner | Başlık doğrulaması ValidationPipe dışında. |
| Ödeme `failed` durumu | Reddedilen tahsilat saklanmaz (sipariş geri alınır, FK hedefi kalmaz), loglanır; `failed` değeri ileride asenkron sağlayıcılar için durur | Spec "sipariş ve porsiyon düşümü geri alınır" diyor. |
| `PaymentsService` tahsilatı kaydeder | Ödeme satırı `OrderRepository.place` transaction'ında `charge` callback'inin döndürdüğü kayıttan yazılır; iadeleri `PaymentsService` günceller | Satır siparişle aynı transaction'da olmalı (FK + geri alma). |
| Kod "çakışmada yeniden üretilir" | `INSERT … ON CONFLICT DO NOTHING RETURNING id` + en çok 10 deneme | Unique ihlali Postgres transaction'ını düşürür; `ON CONFLICT` düşürmez. |
| e2e 3: `DEV_PAYMENT_FAIL` → 402 | Ayrı dosya, yalnız `DEV_PAYMENT_FAIL=true` ile 3002'de açılan ikinci API'ye karşı koşar; normal pakette atlanır | Çalışan dev API'nin env'i testten değiştirilemez; sağlayıcıya "sihirli tutar" eklemek spec dışı davranış olurdu. |
| e2e 6: süre dolması | `expiresAt` test yardımcısındaki doğrudan SQL bağlantısıyla geçmişe alınır | 3 dakika beklemek pratik değil. |
| `@nestjs/schedule` | `6.1.3`, `--save-exact` | 12.x yalnız ESM; proje CommonJS + Nest 11. |
| `reject {reason}` | `cancelledBy` null kalır | Spec diyagramı `cancelledBy`'ı yalnız iptal (customer/cook) ve süre dolmasına (system) yazar; ret durumu zaten aşçıyı söyler. |
| Aşçı sekmeleri sırası | `new` (spec), `preparing`, `ready` en eski üstte; `done` `COALESCE(completedAt, closedAt)`'e göre en yeni üstte | Mutfak kuyruğu FIFO. Spec `closedAt`'i yalnız ret/iptal/süre dolmasına yazdığı için tamamlanma `completedAt`'ten okunur. |
| Müşteri listesi | İki kapsam da en yeni üstte; sonsuz kaydırma yanıtı `{ data, hasNextPage }` (keşif gibi), `page ≤ 1000`, `limit ≤ 50` | Faz 2 §8 sayfalama sınırı. |
| Yanıt alanları | Müşteri kartına `fulfillment` ve `kitchen.id`; detayda `estimatedMinutes` yalnız `pending`'de dolu | Takip çubuğu ve mutfak detayına geçiş; kabulden sonra `estimatedReadyAt` var. |
| "Aşçı adı/fotoğrafı" | Müşteriye aşçı da "Ad S." biçiminde | Müşteriye gösterilen adla simetrik gizlilik. |
| Okumada süre kontrolü (`GET`) | Müşteri iptali ve aşçı eylemleri de önce süresi geçenleri kapatır | Süresi geçmiş siparişi kabul etmek/iptal etmek mümkün olmasın; sonuç 409. |
| Durum eylemlerinin yanıtı | `POST …/cancel` ve aşçı eylemleri 200 + güncel detay | İstemci yeniden çekmeden ekranı günceller. |
| Hesap silme kontrolü | Önce süresi geçmiş `pending`'ler kapatılır, sonra aktif sipariş sorgulanır | Taramayı beklemeyen kullanıcı yanlışlıkla 409 almasın. |
| Seed "seed müşterisi" | Yeni dev müşterisi `dev:+905550000201` (Deniz Arslan) + adres; ücretsiz teslimat eşiği artık yalnız ilk mutfakta (₺300), minimum üçüncüde (₺150); seed siparişleri porsiyon düşmez | Mevcut seed kullanıcısı (`john.doe`) telefonla giremez, mobil yalnız telefonla girer. "Birine … birine" ayrımı. Mevcut dev DB'de mutfak değerleri değişmez (seed yalnız ekler). |
| e2e "Faz 2 akışına eklenir" | Yeni `test/user/orders.e2e-spec.ts` + `test/utils/orders.ts` | Katalog e2e'si sonunda aşçıyı siliyor; sipariş akışı kendi aşçı/müşteri/mutfağını kurar. |
| Hata zarfında `data: null` | `AllExceptionsFilter` 4xx gövdesindeki `data`'yı geçirir | 409 `orderTotalChanged` `data.quote` taşımalı. |
