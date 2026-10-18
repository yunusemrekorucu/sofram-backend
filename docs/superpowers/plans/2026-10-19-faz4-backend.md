# Faz 4 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sofram API'sine güven katmanını eklemek: tamamlanmış siparişe değerlendirme (mutfak puanı aynı transaction'da), aşçı yanıtı/bildirimi ve admin gizlemesi, mutfak favorileri (keşif kartlarında puan ve kalp), sorun bildirimi (destek maili, admin çözümü, kısmi iade), sipariş bazlı mesajlaşma (okunmamış sayıları), sipariş ekranlarına güven alanları, hesap silme kuralları ve geliştirme seed'i.

**Architecture:** NestJS + TypeORM (brocoders boilerplate, hexagonal). Saf kurallar (`canReview`, `canReportIssue`, `canMessage`, `ratingSummary`, `topTags`, `unreadRule`, `canRefund`) birim testli; dört yeni tablo grubu (`review` + `review_report`, `favorite`, `order_issue`, `order_message`) generator ile üretilir, her özelliğin repository'si kendi görevinde e2e ile birlikte gelir. Puanı değiştiren her yazım (oluştur, sil, gizle) mutfak satırını `FOR UPDATE` kilitleyip `kitchen.ratingAvg/ratingCount`'u aynı transaction'da yeniden hesaplar; kısmi iade sorun satırı kilitliyken `PaymentsService.refundPartial` (ödeme satırı kilitli) üzerinden yapılır. Sipariş ekranlarının güven alanları tek bir `OrderTrustService`'ten gelir; sipariş modülü yalnız persistence modüllerini okur (döngü yok).

**Tech Stack:** NestJS 11, TypeORM 0.3.28, PostgreSQL 16 (Homebrew, Docker yok), class-validator 0.15 / class-transformer 0.5, nodemailer + Handlebars (mevcut `MailerService`), Jest 30 + supertest. Yeni bağımlılık yok.

**Spec:** `docs/superpowers/specs/2026-10-19-faz4-guven-design.md` (bağlayıcı). Faz 1, Faz 2 ve Faz 3 spec'lerinin kararları ve **§8 "Uygulama notları"** tabloları (Faz 3 için planın Uygulama notları) geçerli: `/discover/...` yolları, müşteriye dönen mesafe **yuvarlanmış** mutfak noktasından, sayfalama `{ data, hasNextPage }` + `page ≤ 1000`, `limit ≤ 50`, durum/enum alanları `varchar` + TypeScript enum. Bu planın kendi kararları en sondaki **Uygulama notları** tablosunda.

## Global Constraints

- Yanıt zarfı ve hata formatı Faz 1'deki gibi: `{ data, status, statusCode, message }`; hata `errors: { field, message }[]`. 204 sarılmaz. Alan hataları `new UnprocessableEntityException({ status: 422, errors: { field: 'key' } })`; diğerleri `{ status, error: 'key' }` (filtre `error`'ı `message` yapar).
- Başkasının kaydı → **404** (`orNotFound(...)`), 403 değil. Tüm uçlar JWT ister; admin uçları ayrıca `@Roles(RoleEnum.admin)` + `RolesGuard` (admin olmayana 403).
- Pencereler (spec §1, §2.4): değerlendirme **7 gün** (`REVIEW_WINDOW_DAYS=7`, `completedAt`'ten), sorun bildirimi **48 saat** (`ISSUE_WINDOW_HOURS=48`, `completedAt ?? closedAt`'ten), mesajlaşma kapanıştan **24 saat** sonrasına kadar (`MESSAGING_WINDOW_HOURS=24`), takılı teslimat `onTheWayAt + 2 saat < now`. `SUPPORT_EMAIL` yeni sorunların gittiği adres (geliştirmede maildev).
- `canReview`: `status = completed`, `completedAt + 7 gün > now`, değerlendirme yok. `canReportIssue`: `completed` veya aşçı tarafından `cancelled` ise `(completedAt ?? closedAt) + 48 saat > now`; `on_the_way` ise `onTheWayAt + 2 saat < now`; açık kayıt yok. `canMessage`: aktif ya da `closedAt/completedAt + 24 saat > now`. `ratingSummary`: gizli ve silinmiş hariç ortalama, `Math.round(avg × 10) / 10`.
- Değerlendirme: genel puan **1–5 zorunlu**; `taste`, `portion`, `packaging`, `timing` isteğe bağlı 1–5; etiketler (`ReviewTag`) `homemade`, `generous_portion`, `arrived_hot`, `well_packaged`, `on_time`, `friendly_cook` (0–3, tekrarsız); yorum ≤ 500; fotoğraf 0–3 (var olan dosya). Sipariş başına bir; düzenlenemez, yazan silebilir.
- Aşçı yanıtı ≤ 300 (değerlendirme başına bir, düzenlenir/silinir). Bildirim sebebi (`ReviewReportReason`) `offensive`, `false_claim`, `not_my_order`, `other`; not ≤ 300; bildirilen değerlendirme görünür kalır. Gizli değerlendirme puana katılmaz.
- Sorun: kategori (`IssueCategory`) `missing_item`, `wrong_item`, `quality_hygiene`, `late`, `health_issue`, `other`; açıklama 10–1000 (zorunlu); fotoğraf 0–3; istenen çözüm (`IssueResolution`) `refund_full`, `refund_partial`, `none`; durum (`IssueStatus`) `open`, `resolved`, `rejected`; `refundKurus` int (nullable), `adminNote` ≤ 500. Sipariş başına bir **açık** kayıt (kısmi unique index `status = 'open'`).
- Mesaj: `senderRole` (`MessageSide`) `customer` | `cook`; gövde ≤ 500 (boş olamaz); fotoğraf yok; telefon hiçbir tarafa dönmez. Sorgu en çok 100 mesaj, en eski üstte, `after` verilirse yalnız yeniler. Okuma `customerLastReadAt`/`cookLastReadAt = now` yazar.
- Hata anahtarları: **409 `reviewNotAllowed`**, **409 `reviewExists`**, **409 `reviewAlreadyReported`**, **409 `issueNotAllowed`**, **409 `messagingClosed`**, **422 `refundKurus`** (alan: ≤ 0, iade toplamı ödenen tutarı aşıyor, ret ile birlikte iade). Bu planın eklediği: **409 `issueClosed`** (karara bağlanmış sorun), **502 `refundFailed`** (sağlayıcı iadeyi reddetti).
- Para her yerde **kuruş, tamsayı**. `payment.refundedKurus` (int, default 0): tam iade `amountKurus`'a eşitler; kısmi iade sonrası durum `paid` kalır, toplam `amountKurus`'u geçemez; tam tutara ulaşan kısmi iade ödemeyi `refunded` yapar.
- `kitchen.ratingAvg` (`double precision`, nullable) ve `ratingCount` (int, default 0) türetilmiştir: yalnız değerlendirme transaction'ları yazar, `PATCH /kitchens/me` asla yazmaz. Keşif sıralamasına puan **girmez**.
- Hesap silme sırası: **409 kontrolü → anonimleştirme → sipariş adresleri → değerlendirmeler → favoriler → mesajlar → ürünler → mutfak → adresler → oturumlar**. Değerlendirmeler soft-delete (+ puan yeniden hesaplanır), favoriler ve kullanıcının yazdığı mesajlar hard-delete, sorun kayıtları kalır; aşçı silinince mutfağın değerlendirmeleri soft-delete, yanıtları temizlenir.
- Entity ve alanlar **önce generator ile** eklenir (`npm run generate:resource:relational -- --name X`, `npm run add:property:to-relational -- ...`), sonra dosyalar bu plandaki son hallerine getirilir. `id`/`createdAt`/`updatedAt` generator'a verilmez; `User`/`File` generate edilmez. Generator'ların `postscript`'i `lint --fix` çalıştırır; mevcut dosyalara enjekte ettikleri satırlar ara adımda sözdizimini bozar (lint hatası, npm çıkış kodu ≠ 0 normal) — komutları `set -e` olmadan, sırayla çalıştır.
- Migration'lar elle yazılmaz: `npm run migration:generate -- src/database/migrations/<Ad>` + `npm run migration:run`. Tek istisna Task 2'deki tek satırlık veri düzeltmesi (`refundedKurus` geriye dönük doldurma), adımda yazılı.
- Ham SQL'de sütunlar tırnaklı (`o."kitchenId"`), `order` tablosu her zaman `"order"`. Yeni tablolarda zaman sütunları `timestamptz`.
- Testlerde `it(...)` adları `should` ile başlar (ESLint kuralı); `configService.get/getOrThrow` her zaman `{ infer: true }` ile.
- Kod blokları: "`yol` — dosyanın tamamı:" dosyayı olduğu gibi yazar; "`yol` — şu bloğu: … şununla değiştir:" blokları dosyada birebir ve tek geçer (Edit aracıyla uygulanır), aynı dosyanın blokları yukarıdan aşağı sırayla uygulanır.
- Commit: `main` üzerinde (dal açılmaz), conventional commits, konu küçük harfle (commitlint `subject-case`). Husky pre-commit `lint` + `test` çalıştırır. Her commit mesajı şu satırla biter:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Yerel ortam: API `http://localhost:3001` (`npm run start:dev`, watch mode — `CI=1` ile başlatma, izleme kapanır), Postgres `localhost:5432` db/rol `sofram`, `.env`'de `AUTH_PHONE_DEV_VERIFIER=true`, maildev `npx -y maildev@2.2.1 -s 1025 -w 1080` (sorun maili e2e'si `/email`'i okur). `npm run build` `dist/`'i silip çalışan dev API'yi düşürür; tip kontrolü için `npx tsc --noEmit -p tsconfig.json`. `.env` commit edilmez.

## File Structure

```
src/trust/                             Faz 4'ün ortak, saf parçaları
  trust.enums.ts                       ReviewTag, ReviewReportReason, ReviewFilter, IssueCategory, IssueResolution, IssueStatus, MessageSide
  trust-rules.ts (+ spec)              canReview, canReportIssue, canMessage, unreadRule, ratingSummary, topTags, STUCK_DELIVERY_HOURS
  trust-errors.ts                      409 reviewNotAllowed, reviewExists, reviewAlreadyReported, issueNotAllowed, issueClosed, messagingClosed
  trust-photos.ts (+ spec)             photosByIds — dosya id'lerini sırasıyla FileType'a çevirir (422 photoIds)
  config/                              trust.config.ts (+ spec), trust-config.type.ts
src/reviews/                           review + review_report
  domain/review.ts, review-report.ts   Review, NewReview, ReviewAuthor, ReviewReport, NewReviewReport
  infrastructure/persistence/          review.repository.ts (port) + relational/ (entities, mappers (+ spec), repository, module)
  dto/                                 create-review.dto.ts, review-actions.dto.ts, list-reviews.dto.ts
  views.ts, presenters.ts (+ spec)     OrderReviewView, ReviewView, KitchenReviewView, ReviewsSummaryView, KitchenReviewsPage, ReviewReportView
  reviews.service.ts (+ spec)          müşteri, aşçı, admin ve hesap silme işleri
  reviews.controller.ts                POST /orders/:id/review, DELETE /reviews/:id, GET /discover/kitchens/:id/reviews
  cook-reviews.controller.ts           /kitchens/me/reviews
  admin-reviews.controller.ts          /admin/review-reports, /admin/reviews/:id
  review.fixture.ts, reviews.module.ts
src/favorites/                         favorite (domain sınıfı yok; repository Kitchen döner)
  infrastructure/persistence/          favorite.repository.ts + relational/ (entity, repository, module)
  dto/list-favorites.dto.ts, favorites.service.ts (+ spec), favorites.controller.ts, favorites.module.ts
src/order-issues/                      order_issue
  domain/order-issue.ts                OrderIssue, NewOrderIssue, OrderIssueResolution
  infrastructure/persistence/          order-issue.repository.ts + relational/ (entity, mapper, repository, module)
  dto/, views.ts, presenters.ts        IssueSummaryView, IssueView, AdminIssueView
  order-issues.service.ts (+ spec)     bildir + destek maili, admin listesi/çözümü
  order-issues.controller.ts, admin-order-issues.controller.ts, order-issue.fixture.ts, order-issues.module.ts
src/order-messages/                    order_message
  domain/order-message.ts, infrastructure/persistence/ (port + relational)
  dto/order-messages.dto.ts, views.ts, order-messages.service.ts (+ spec)
  order-messages.controller.ts         /orders/:id/messages
  cook-order-messages.controller.ts    /kitchens/me/orders/:id/messages
src/orders/order-trust.service.ts (+ spec)  sipariş ekranlarının review/issue/sohbet alanları
src/orders/…                           views/presenters/services genişler, Order'a okuma işaretleri, markRead
src/payments/payment-rules.ts (+ spec) canRefund; PaymentsService.refundPartial, refundedKurus
src/kitchens/…                         ratingAvg, ratingCount (PATCH yazmaz)
src/discovery/…                        KitchenSummary.ratingAvg/ratingCount, KitchenCard.isFavorite, roundedDistanceKm
src/mail/…                             issueReported + issue-reported.hbs
src/users/users.service.ts (+ spec)    hesap silme zinciri
src/database/migrations/*              (generate) CreateTrust
src/database/seeds/relational/trust/   değerlendirme, favori, sohbet, sorun seed'i
test/utils/orders.ts                   + uploadPhoto, adminLogin, placeOrder, cookStep, completeOrder
test/user/*.e2e-spec.ts                reviews, favorites, order-issues, order-messages, trust-deletion (+ orders özet beklentisi)
CLAUDE.md                              API conventions'a Faz 4 kuralları
```

**Görev sırası ve neden:** Önerilen sıra korunur (çekirdek → şema → değerlendirme → favori → sorun → mesaj + sipariş ekranları → hesap silme/seed). İki seam değişikliği: (1) Task 2 yalnız **şemayı** getirir (entity, domain, mapper, migration ve mevcut tablolara eklenen sütunların domain/mapper'ı); her özelliğin repository'si, SQL'i e2e testiyle aynı görevde olsun diye kendi görevinde yazılır. (2) Hata anahtarları ve fotoğraf doğrulaması Task 1'e (çekirdek) alınır; değerlendirme ve sorun görevleri ikisini de kullanır. Sipariş ekranı alanları mesajlaşmayla aynı görevde (Task 6), çünkü üçünün (review, issue, mesaj) okuma metotları o zaman tamamlanmış olur.

---

### Task 0: Başlangıç durumunu doğrula

**Files:** yok (yalnızca doğrulama)

- [ ] **Step 1: Servisleri ve dalı kontrol et**

Run: `git status --short && git branch --show-current && git log --oneline -1 && lsof -i :3001 -sTCP:LISTEN; lsof -i :1080 -sTCP:LISTEN; pg_isready; grep AUTH_PHONE_DEV_VERIFIER .env`
Expected: dal `main`, son commit `feat(users): keep accounts with open orders; seed dev orders`, çalışma ağacında yalnız plan/spec dosyaları (varsa); 3001'de node (API), 1080'de maildev; Postgres "accepting connections"; `AUTH_PHONE_DEV_VERIFIER=true`. API çalışmıyorsa ayrı bir terminalde (arka planda) `npm run start:dev`, maildev çalışmıyorsa `npx -y maildev@2.2.1 -s 1025 -w 1080` başlat.

- [ ] **Step 2: Migration'lar uygulanmış mı**

Run: `npm run typeorm -- --dataSource=src/database/data-source.ts migration:show`
Expected: dokuz migration'ın hepsi `[X]` (`CreateUser` … `KitchenMinOrder`, `CreateOrders`). `[ ]` varsa DURUP kullanıcıya bildir.

- [ ] **Step 3: Birim ve e2e paketlerini çalıştır**

Run: `npm test && npm run test:e2e -- --runInBand`
Expected: ikisi de PASS (`order-payment` dosyası atlanır). Kırmızı test varsa DURUP kullanıcıya bildir — başlangıç bozuksa sonraki görevlerin sonucu yorumlanamaz.

---

### Task 1: Güven çekirdeği (saf kurallar, hatalar, fotoğraf doğrulaması, yapılandırma)

**Files:**
- Create: `src/trust/trust.enums.ts`, `src/trust/trust-rules.ts`, `src/trust/trust-errors.ts`, `src/trust/trust-photos.ts`
- Test: `src/trust/trust-rules.spec.ts`, `src/trust/trust-photos.spec.ts`
- Create: `src/trust/config/trust-config.type.ts`, `src/trust/config/trust.config.ts`, `src/trust/config/trust.config.spec.ts`
- Modify: `src/config/config.type.ts`, `src/app.module.ts` (ConfigModule `load`), `env-example-relational`, `.env`

**Interfaces:**
- Consumes: `Order` (`src/orders/domain/order.ts`), `ACTIVE_STATUSES` (`src/orders/order-status.ts`), `OrderStatus`, `CancelledBy` (`src/orders/order.enums.ts`), `FileType`, `FilesService.findByIds`, `validateConfig` (`src/utils/validate-config.ts`).
- Produces:
  - `enum ReviewTag { homemade, generousPortion = 'generous_portion', arrivedHot = 'arrived_hot', wellPackaged = 'well_packaged', onTime = 'on_time', friendlyCook = 'friendly_cook' }`, `enum ReviewReportReason { offensive, falseClaim = 'false_claim', notMyOrder = 'not_my_order', other }`, `enum ReviewFilter { all, unreplied }`, `enum IssueCategory { missingItem = 'missing_item', wrongItem = 'wrong_item', qualityHygiene = 'quality_hygiene', late, healthIssue = 'health_issue', other }`, `enum IssueResolution { refundFull = 'refund_full', refundPartial = 'refund_partial', none }`, `enum IssueStatus { open, resolved, rejected }`, `enum MessageSide { customer, cook }` (değerler küçük harf string).
  - `STUCK_DELIVERY_HOURS = 2`, `TOP_TAG_COUNT = 3`, `type TrustOrder = Pick<Order, 'status' | 'cancelledBy' | 'completedAt' | 'closedAt' | 'onTheWayAt'>`; `canReview(order: TrustOrder, hasReview: boolean, now: Date, windowDays: number): boolean`; `canReportIssue(order: TrustOrder, hasOpenIssue: boolean, now: Date, windowHours: number): boolean`; `canMessage(order: TrustOrder, now: Date, windowHours: number): boolean`; `type ReadMarker = 'customerLastReadAt' | 'cookLastReadAt'`; `unreadRule(viewer: MessageSide): { senderRole: MessageSide; readMarker: ReadMarker }`; `RATINGS`, `type Rating = 1|2|3|4|5`, `type RatingDistribution = Record<Rating, number>`, `type RatingGroup = { rating: number; isHidden: boolean; isDeleted: boolean; count: number }`, `type RatingSummary = { ratingAvg: number | null; ratingCount: number; distribution: RatingDistribution }`; `ratingSummary(groups: RatingGroup[]): RatingSummary`; `topTags(counts: { tag: ReviewTag; count: number }[]): ReviewTag[]`.
  - `reviewNotAllowed()`, `reviewExists()`, `reviewAlreadyReported()`, `issueNotAllowed()`, `issueClosed()`, `messagingClosed()` — her biri `ConflictException` (`{ status: 409, error: '<anahtar>' }`) döner.
  - `photosByIds(filesService: FilesService, ids: string[]): Promise<FileType[]>` (istenen sırayla; bilinmeyen id → 422 `photoIds: imageNotExists`).
  - Config: `configService.getOrThrow('trust', { infer: true })` → `TrustConfig = { reviewWindowDays; issueWindowHours; messagingWindowHours; supportEmail }`; tek tek `'trust.reviewWindowDays' | 'trust.issueWindowHours' | 'trust.messagingWindowHours' | 'trust.supportEmail'`.

- [ ] **Step 1: Enum'lar**

`src/trust/trust.enums.ts` — dosyanın tamamı:

```ts
/** Quick tags a customer may pick for a review (0–3). */
export enum ReviewTag {
  homemade = 'homemade',
  generousPortion = 'generous_portion',
  arrivedHot = 'arrived_hot',
  wellPackaged = 'well_packaged',
  onTime = 'on_time',
  friendlyCook = 'friendly_cook',
}

/** Why a cook reports a review; the review stays visible until an admin hides it. */
export enum ReviewReportReason {
  offensive = 'offensive',
  falseClaim = 'false_claim',
  notMyOrder = 'not_my_order',
  other = 'other',
}

/** The cook's review list (GET /kitchens/me/reviews?filter=). */
export enum ReviewFilter {
  all = 'all',
  unreplied = 'unreplied',
}

export enum IssueCategory {
  missingItem = 'missing_item',
  wrongItem = 'wrong_item',
  qualityHygiene = 'quality_hygiene',
  late = 'late',
  healthIssue = 'health_issue',
  other = 'other',
}

/** What the customer asks for when reporting an issue. */
export enum IssueResolution {
  refundFull = 'refund_full',
  refundPartial = 'refund_partial',
  none = 'none',
}

export enum IssueStatus {
  open = 'open',
  resolved = 'resolved',
  rejected = 'rejected',
}

/** The two parties of an order's chat. */
export enum MessageSide {
  customer = 'customer',
  cook = 'cook',
}
```

- [ ] **Step 2: Kurallar — test**

`src/trust/trust-rules.spec.ts` — dosyanın tamamı:

```ts
import { CancelledBy, OrderStatus } from '../orders/order.enums';
import {
  TrustOrder,
  canMessage,
  canReportIssue,
  canReview,
  ratingSummary,
  topTags,
  unreadRule,
} from './trust-rules';
import { MessageSide, ReviewTag } from './trust.enums';

const HOUR = 3_600_000;
const CLOSED = new Date('2026-10-12T10:00:00Z');
const after = (hours: number) => new Date(CLOSED.getTime() + hours * HOUR);

const order = (overrides: Partial<TrustOrder> = {}): TrustOrder => ({
  status: OrderStatus.completed,
  cancelledBy: null,
  completedAt: CLOSED,
  closedAt: null,
  onTheWayAt: null,
  ...overrides,
});

describe('canReview', () => {
  it('should allow a completed order without a review for 7 days', () => {
    expect(canReview(order(), false, after(1), 7)).toBe(true);
    expect(canReview(order(), false, after(7 * 24 - 0.01), 7)).toBe(true);
  });

  it('should close exactly 7 days after completion', () => {
    expect(canReview(order(), false, after(7 * 24), 7)).toBe(false);
    expect(canReview(order(), false, after(8 * 24), 7)).toBe(false);
  });

  it('should refuse a second review', () => {
    expect(canReview(order(), true, after(1), 7)).toBe(false);
  });

  it('should refuse every status but completed', () => {
    for (const status of Object.values(OrderStatus)) {
      if (status !== OrderStatus.completed) {
        expect(
          canReview(order({ status, closedAt: CLOSED }), false, after(1), 7),
        ).toBe(false);
      }
    }
  });
});

describe('canReportIssue', () => {
  it('should allow a completed order for 48 hours', () => {
    expect(canReportIssue(order(), false, after(47.9), 48)).toBe(true);
    expect(canReportIssue(order(), false, after(48), 48)).toBe(false);
  });

  it('should allow an order the cook cancelled, counted from closing', () => {
    const cancelled = order({
      status: OrderStatus.cancelled,
      cancelledBy: CancelledBy.cook,
      completedAt: null,
      closedAt: CLOSED,
    });

    expect(canReportIssue(cancelled, false, after(10), 48)).toBe(true);
    expect(canReportIssue(cancelled, false, after(49), 48)).toBe(false);
  });

  it('should refuse a customer cancellation, a rejection and an expiry', () => {
    for (const closed of [
      { status: OrderStatus.cancelled, cancelledBy: CancelledBy.customer },
      { status: OrderStatus.rejected, cancelledBy: null },
      { status: OrderStatus.expired, cancelledBy: CancelledBy.system },
    ]) {
      expect(
        canReportIssue(
          order({ ...closed, completedAt: null, closedAt: CLOSED }),
          false,
          after(1),
          48,
        ),
      ).toBe(false);
    }
  });

  it('should allow a delivery stuck on the way for more than 2 hours', () => {
    const onTheWay = order({
      status: OrderStatus.onTheWay,
      completedAt: null,
      onTheWayAt: CLOSED,
    });

    expect(canReportIssue(onTheWay, false, after(1.9), 48)).toBe(false);
    expect(canReportIssue(onTheWay, false, after(2), 48)).toBe(false);
    expect(canReportIssue(onTheWay, false, after(2.1), 48)).toBe(true);
  });

  it('should refuse the other active statuses', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
    ]) {
      expect(
        canReportIssue(
          order({ status, completedAt: null }),
          false,
          after(5),
          48,
        ),
      ).toBe(false);
    }
  });

  it('should refuse while a report of the order is open', () => {
    expect(canReportIssue(order(), true, after(1), 48)).toBe(false);
  });
});

describe('canMessage', () => {
  it('should allow every active order', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
      OrderStatus.onTheWay,
    ]) {
      expect(
        canMessage(order({ status, completedAt: null }), after(100), 24),
      ).toBe(true);
    }
  });

  it('should allow 24 hours after completion or closing, then go read-only', () => {
    const rejected = order({
      status: OrderStatus.rejected,
      completedAt: null,
      closedAt: CLOSED,
    });

    expect(canMessage(order(), after(23.9), 24)).toBe(true);
    expect(canMessage(order(), after(24), 24)).toBe(false);
    expect(canMessage(rejected, after(23.9), 24)).toBe(true);
    expect(canMessage(rejected, after(24.1), 24)).toBe(false);
  });
});

describe('unreadRule', () => {
  it('should count the cook’s messages after the customer’s marker', () => {
    expect(unreadRule(MessageSide.customer)).toEqual({
      senderRole: MessageSide.cook,
      readMarker: 'customerLastReadAt',
    });
  });

  it('should count the customer’s messages after the cook’s marker', () => {
    expect(unreadRule(MessageSide.cook)).toEqual({
      senderRole: MessageSide.customer,
      readMarker: 'cookLastReadAt',
    });
  });
});

describe('ratingSummary', () => {
  const group = (rating: number, count: number, extra = {}) => ({
    rating,
    count,
    isHidden: false,
    isDeleted: false,
    ...extra,
  });

  it('should average to one decimal and fill every star', () => {
    expect(ratingSummary([group(5, 2), group(4, 1)])).toEqual({
      ratingAvg: 4.7,
      ratingCount: 3,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 },
    });
  });

  it('should round halves up', () => {
    // 87 / 20 = 4.35
    expect(ratingSummary([group(5, 7), group(4, 13)]).ratingAvg).toBe(4.4);
    // 9 / 4 = 2.25
    expect(ratingSummary([group(3, 1), group(2, 3)]).ratingAvg).toBe(2.3);
  });

  it('should leave hidden and deleted reviews out', () => {
    expect(
      ratingSummary([
        group(5, 1),
        group(1, 3, { isHidden: true }),
        group(1, 2, { isDeleted: true }),
      ]),
    ).toEqual({
      ratingAvg: 5,
      ratingCount: 1,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    });
  });

  it('should have no average without a counted review', () => {
    expect(ratingSummary([group(4, 1, { isHidden: true })])).toEqual({
      ratingAvg: null,
      ratingCount: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });
});

describe('topTags', () => {
  it('should keep the three most picked tags, most first', () => {
    expect(
      topTags([
        { tag: ReviewTag.onTime, count: 1 },
        { tag: ReviewTag.homemade, count: 5 },
        { tag: ReviewTag.arrivedHot, count: 3 },
        { tag: ReviewTag.friendlyCook, count: 2 },
      ]),
    ).toEqual([
      ReviewTag.homemade,
      ReviewTag.arrivedHot,
      ReviewTag.friendlyCook,
    ]);
  });

  it('should break ties by the tag order', () => {
    expect(
      topTags([
        { tag: ReviewTag.friendlyCook, count: 2 },
        { tag: ReviewTag.generousPortion, count: 2 },
      ]),
    ).toEqual([ReviewTag.generousPortion, ReviewTag.friendlyCook]);
  });

  it('should be empty without tags', () => {
    expect(topTags([])).toEqual([]);
  });
});
```

Run: `npx jest src/trust/trust-rules.spec.ts` → FAIL (`Cannot find module './trust-rules'`).

- [ ] **Step 3: Kurallar — kod**

`src/trust/trust-rules.ts` — dosyanın tamamı:

```ts
import { Order } from '../orders/domain/order';
import { ACTIVE_STATUSES } from '../orders/order-status';
import { CancelledBy, OrderStatus } from '../orders/order.enums';
import { MessageSide, ReviewTag } from './trust.enums';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A delivery on the way for longer than this counts as stuck and may be reported. */
export const STUCK_DELIVERY_HOURS = 2;

/** How many tags the review summary shows. */
export const TOP_TAG_COUNT = 3;

export type TrustOrder = Pick<
  Order,
  'status' | 'cancelledBy' | 'completedAt' | 'closedAt' | 'onTheWayAt'
>;

/** Completion, or rejection/cancellation/expiry — whichever closed the order. */
const closedAtOf = (order: TrustOrder): Date | null =>
  order.completedAt ?? order.closedAt;

const within = (from: Date, ms: number, now: Date) =>
  from.getTime() + ms > now.getTime();

/**
 * Only a completed order, once (a deleted review counts — reviews cannot be
 * edited by deleting and writing again), within `windowDays` of completion.
 */
export function canReview(
  order: TrustOrder,
  hasReview: boolean,
  now: Date,
  windowDays: number,
): boolean {
  return (
    order.status === OrderStatus.completed &&
    order.completedAt !== null &&
    !hasReview &&
    within(order.completedAt, windowDays * DAY_MS, now)
  );
}

/**
 * A completed order or one the cook cancelled, within `windowHours` of
 * closing; or a delivery stuck on the way. Never while another report of the
 * order is still open.
 */
export function canReportIssue(
  order: TrustOrder,
  hasOpenIssue: boolean,
  now: Date,
  windowHours: number,
): boolean {
  if (hasOpenIssue) {
    return false;
  }

  if (order.status === OrderStatus.onTheWay) {
    return (
      order.onTheWayAt !== null &&
      order.onTheWayAt.getTime() + STUCK_DELIVERY_HOURS * HOUR_MS <
        now.getTime()
    );
  }

  const cancelledByCook =
    order.status === OrderStatus.cancelled &&
    order.cancelledBy === CancelledBy.cook;

  if (order.status !== OrderStatus.completed && !cancelledByCook) {
    return false;
  }

  const closedAt = closedAtOf(order);
  return closedAt !== null && within(closedAt, windowHours * HOUR_MS, now);
}

/** While the order is open and for `windowHours` after it closed; read-only afterwards. */
export function canMessage(
  order: TrustOrder,
  now: Date,
  windowHours: number,
): boolean {
  if (ACTIVE_STATUSES.includes(order.status)) {
    return true;
  }

  const closedAt = closedAtOf(order);
  return closedAt !== null && within(closedAt, windowHours * HOUR_MS, now);
}

export type ReadMarker = 'customerLastReadAt' | 'cookLastReadAt';

/**
 * Unread for `viewer`: the other side's messages written after the viewer's
 * read marker on the order (all of them before the first read). Reading the
 * chat moves `readMarker` to now.
 */
export function unreadRule(viewer: MessageSide): {
  senderRole: MessageSide;
  readMarker: ReadMarker;
} {
  return viewer === MessageSide.customer
    ? { senderRole: MessageSide.cook, readMarker: 'customerLastReadAt' }
    : { senderRole: MessageSide.customer, readMarker: 'cookLastReadAt' };
}

export const RATINGS = [1, 2, 3, 4, 5] as const;

export type Rating = (typeof RATINGS)[number];

export type RatingDistribution = Record<Rating, number>;

/** Reviews of a kitchen grouped by star, visibility and deletion (one SQL GROUP BY). */
export type RatingGroup = {
  rating: number;
  isHidden: boolean;
  isDeleted: boolean;
  count: number;
};

export type RatingSummary = {
  /** One decimal; null without a counted review ("Yeni"). */
  ratingAvg: number | null;
  ratingCount: number;
  distribution: RatingDistribution;
};

/** Hidden and deleted reviews do not count; the average is rounded to one decimal. */
export function ratingSummary(groups: RatingGroup[]): RatingSummary {
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  for (const group of groups) {
    if (!group.isHidden && !group.isDeleted) {
      distribution[group.rating as Rating] += group.count;
    }
  }

  const ratingCount = RATINGS.reduce(
    (sum, star) => sum + distribution[star],
    0,
  );
  const stars = RATINGS.reduce(
    (sum, star) => sum + star * distribution[star],
    0,
  );

  return {
    ratingAvg: ratingCount ? Math.round((stars / ratingCount) * 10) / 10 : null,
    ratingCount,
    distribution,
  };
}

const TAG_ORDER = Object.values(ReviewTag);

/** The most picked tags, most first; a tie keeps the ReviewTag order. */
export function topTags(
  counts: { tag: ReviewTag; count: number }[],
): ReviewTag[] {
  return [...counts]
    .filter((entry) => entry.count > 0 && TAG_ORDER.includes(entry.tag))
    .sort(
      (a, b) =>
        b.count - a.count ||
        TAG_ORDER.indexOf(a.tag) - TAG_ORDER.indexOf(b.tag),
    )
    .slice(0, TOP_TAG_COUNT)
    .map((entry) => entry.tag);
}
```

Run: `npx jest src/trust/trust-rules.spec.ts` → PASS (21 test).

- [ ] **Step 4: Hata anahtarları ve fotoğraf doğrulaması — test**

`src/trust/trust-photos.spec.ts` — dosyanın tamamı:

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { photosByIds } from './trust-photos';

const file = (id: string) =>
  Object.assign(new FileType(), { id, path: `/${id}.png` });

const filesService = (known: string[]) =>
  ({
    findByIds: jest.fn((ids: string[]) =>
      Promise.resolve(ids.filter((id) => known.includes(id)).map(file)),
    ),
  }) as unknown as FilesService;

describe('photosByIds', () => {
  it('should keep the requested order', async () => {
    const photos = await photosByIds(filesService(['a', 'b']), ['b', 'a']);

    expect(photos.map((photo) => photo.id)).toEqual(['b', 'a']);
  });

  it('should 422 an unknown file', async () => {
    const error = await photosByIds(filesService(['a']), ['a', 'x']).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      status: 422,
      errors: { photoIds: 'imageNotExists' },
    });
  });

  it('should not query without photos', async () => {
    const files = filesService([]);

    await expect(photosByIds(files, [])).resolves.toEqual([]);
    expect(files.findByIds).not.toHaveBeenCalled();
  });
});
```

Run: `npx jest src/trust/trust-photos.spec.ts` → FAIL (modül yok).

- [ ] **Step 5: Hata anahtarları ve fotoğraf doğrulaması — kod**

`src/trust/trust-errors.ts` — dosyanın tamamı:

```ts
import { ConflictException, HttpStatus } from '@nestjs/common';

const conflict = (error: string) => () =>
  new ConflictException({ status: HttpStatus.CONFLICT, error });

/** Not completed, or the review window is over. */
export const reviewNotAllowed = conflict('reviewNotAllowed');

/** The order already has a review (a deleted one counts). */
export const reviewExists = conflict('reviewExists');

/** This cook already reported this review. */
export const reviewAlreadyReported = conflict('reviewAlreadyReported');

/** Wrong status, the window is over, or a report of the order is still open. */
export const issueNotAllowed = conflict('issueNotAllowed');

/** An admin already resolved or rejected this report. */
export const issueClosed = conflict('issueClosed');

/** The chat is read-only: the order closed more than the window ago. */
export const messagingClosed = conflict('messagingClosed');
```

`src/trust/trust-photos.ts` — dosyanın tamamı:

```ts
import { HttpStatus, UnprocessableEntityException } from '@nestjs/common';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';

/** Uploaded files in the requested order; any unknown id is a 422 `photoIds: imageNotExists`. */
export async function photosByIds(
  filesService: FilesService,
  ids: string[],
): Promise<FileType[]> {
  if (ids.length === 0) {
    return [];
  }

  const byId = new Map(
    (await filesService.findByIds(ids)).map((file) => [file.id, file]),
  );

  if (ids.some((id) => !byId.has(id))) {
    throw new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors: { photoIds: 'imageNotExists' },
    });
  }

  return ids.map((id) => byId.get(id) as FileType);
}
```

Run: `npx jest src/trust/trust-photos.spec.ts` → PASS (3 test).

- [ ] **Step 6: Yapılandırma — test**

`src/trust/config/trust.config.spec.ts` — dosyanın tamamı:

```ts
import trustConfig from './trust.config';

const KEYS = [
  'REVIEW_WINDOW_DAYS',
  'ISSUE_WINDOW_HOURS',
  'MESSAGING_WINDOW_HOURS',
  'SUPPORT_EMAIL',
];

describe('trustConfig', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    KEYS.forEach((key) => delete process.env[key]);
    process.env.SUPPORT_EMAIL = 'destek@sofram.local';
  });

  afterAll(() => {
    process.env = saved;
  });

  it('should default to 7 days, 48 hours and 24 hours', () => {
    expect(trustConfig()).toEqual({
      reviewWindowDays: 7,
      issueWindowHours: 48,
      messagingWindowHours: 24,
      supportEmail: 'destek@sofram.local',
    });
  });

  it('should read the environment', () => {
    process.env.REVIEW_WINDOW_DAYS = '14';
    process.env.ISSUE_WINDOW_HOURS = '72';
    process.env.MESSAGING_WINDOW_HOURS = '12';

    expect(trustConfig()).toMatchObject({
      reviewWindowDays: 14,
      issueWindowHours: 72,
      messagingWindowHours: 12,
    });
  });

  it('should require a support address', () => {
    delete process.env.SUPPORT_EMAIL;

    expect(() => trustConfig()).toThrow();
  });

  it('should refuse out-of-range windows', () => {
    process.env.REVIEW_WINDOW_DAYS = '0';

    expect(() => trustConfig()).toThrow();
  });
});
```

Run: `npx jest src/trust/config` → FAIL (modül yok).

- [ ] **Step 7: Yapılandırma — kod**

`src/trust/config/trust-config.type.ts` — dosyanın tamamı:

```ts
export type TrustConfig = {
  /** A completed order can be reviewed for this many days. */
  reviewWindowDays: number;
  /** An issue can be reported this many hours after the order closed. */
  issueWindowHours: number;
  /** The order chat stays writable this many hours after the order closed. */
  messagingWindowHours: number;
  /** New issue reports are mailed here (maildev in development). */
  supportEmail: string;
};
```

`src/trust/config/trust.config.ts` — dosyanın tamamı:

```ts
import { registerAs } from '@nestjs/config';
import { IsEmail, IsInt, IsOptional, Max, Min } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { TrustConfig } from './trust-config.type';

class EnvironmentVariablesValidator {
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  REVIEW_WINDOW_DAYS: number;

  @IsInt()
  @Min(1)
  @Max(720)
  @IsOptional()
  ISSUE_WINDOW_HOURS: number;

  @IsInt()
  @Min(1)
  @Max(720)
  @IsOptional()
  MESSAGING_WINDOW_HOURS: number;

  @IsEmail()
  SUPPORT_EMAIL: string;
}

export default registerAs<TrustConfig>('trust', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    reviewWindowDays: process.env.REVIEW_WINDOW_DAYS
      ? parseInt(process.env.REVIEW_WINDOW_DAYS, 10)
      : 7,
    issueWindowHours: process.env.ISSUE_WINDOW_HOURS
      ? parseInt(process.env.ISSUE_WINDOW_HOURS, 10)
      : 48,
    messagingWindowHours: process.env.MESSAGING_WINDOW_HOURS
      ? parseInt(process.env.MESSAGING_WINDOW_HOURS, 10)
      : 24,
    supportEmail: process.env.SUPPORT_EMAIL as string,
  };
});
```

`src/config/config.type.ts` — şu bloğu:

```ts
import { MailConfig } from '../mail/config/mail-config.type';
import { OrdersConfig } from '../orders/config/orders-config.type';
import { PaymentsConfig } from '../payments/config/payments-config.type';

export type AllConfigType = {
  app: AppConfig;
```

şununla değiştir:

```ts
import { MailConfig } from '../mail/config/mail-config.type';
import { OrdersConfig } from '../orders/config/orders-config.type';
import { PaymentsConfig } from '../payments/config/payments-config.type';
import { TrustConfig } from '../trust/config/trust-config.type';

export type AllConfigType = {
  app: AppConfig;
```

`src/config/config.type.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
  mail: MailConfig;
  orders: OrdersConfig;
  payments: PaymentsConfig;
};
```

şununla değiştir:

```ts
  mail: MailConfig;
  orders: OrdersConfig;
  payments: PaymentsConfig;
  trust: TrustConfig;
};
```

`src/app.module.ts` — şu bloğu:

```ts
import mailConfig from './mail/config/mail.config';
import ordersConfig from './orders/config/orders.config';
import paymentsConfig from './payments/config/payments.config';
import fileConfig from './files/config/file.config';
import googleConfig from './auth-google/config/google.config';
import appleConfig from './auth-apple/config/apple.config';
```

şununla değiştir:

```ts
import mailConfig from './mail/config/mail.config';
import ordersConfig from './orders/config/orders.config';
import paymentsConfig from './payments/config/payments.config';
import trustConfig from './trust/config/trust.config';
import fileConfig from './files/config/file.config';
import googleConfig from './auth-google/config/google.config';
import appleConfig from './auth-apple/config/apple.config';
```

`src/app.module.ts` — ardından şu bloğu:

```ts
        appleConfig,
        ordersConfig,
        paymentsConfig,
      ],
      envFilePath: ['.env'],
    }),
```

şununla değiştir:

```ts
        appleConfig,
        ordersConfig,
        paymentsConfig,
        trustConfig,
      ],
      envFilePath: ['.env'],
    }),
```

`env-example-relational` — dosyanın sonundaki şu bloğu:

```bash

PAYMENT_PROVIDER=dev
DEV_PAYMENT_FAIL=false
```

şununla değiştir:

```bash

PAYMENT_PROVIDER=dev
DEV_PAYMENT_FAIL=false

REVIEW_WINDOW_DAYS=7
ISSUE_WINDOW_HOURS=48
MESSAGING_WINDOW_HOURS=24
SUPPORT_EMAIL=support@example.com
```

`.env` (commit edilmez) — dosyanın sonuna ekle:

```bash
REVIEW_WINDOW_DAYS=7
ISSUE_WINDOW_HOURS=48
MESSAGING_WINDOW_HOURS=24
SUPPORT_EMAIL=destek@sofram.local
```

Run: `npx jest src/trust && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (28 test), tip hatası yok. Dev API watch modunda yeniden başlar; `SUPPORT_EMAIL` `.env`'de yoksa açılışta `validateConfig` hatası verir — ekle ve tekrar dene.

- [ ] **Step 8: Commit**

Run: `npm run lint && npm test` → temiz, PASS.

```bash
git add src/trust src/config/config.type.ts src/app.module.ts env-example-relational
git commit -m "feat(trust): add review, issue and chat rules with their config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Şema (`review`, `review_report`, `favorite`, `order_issue`, `order_message` + mutfak puanı, okuma işaretleri, `refundedKurus`)

**Files:**
- Generate: `src/reviews/**`, `src/review-reports/**`, `src/favorites/**`, `src/order-issues/**`, `src/order-messages/**`; generator ayrıca `src/app.module.ts`, `src/kitchens/{domain,dto,infrastructure,kitchens.service}`, `src/orders/{domain,dto,infrastructure,orders.service}`, `src/payments/{domain,infrastructure,payments.service}` dosyalarına satır enjekte eder
- Move (generator sonrası): `review-report.entity.ts` → `src/reviews/infrastructure/persistence/relational/entities/`
- Delete (generator sonrası): `src/review-reports/`; dört yeni modülde entity dışındaki her generator dosyası (DTO, controller, service, module, repository, mapper, domain iskeleti)
- Restore (generator sonrası, `git checkout --`): `src/app.module.ts`, `src/kitchens/kitchens.service.ts`, `src/kitchens/dto/create-kitchen.dto.ts`, `src/orders/orders.service.ts`, `src/orders/dto/create-order.dto.ts`, `src/payments/payments.service.ts`
- Create/Overwrite (son halleri aşağıda): `src/kitchens/domain/kitchen.ts`, `src/kitchens/infrastructure/persistence/relational/entities/kitchen.entity.ts`, `src/kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper.ts`, `src/orders/domain/order.ts`, `src/orders/infrastructure/persistence/relational/entities/order.entity.ts`, `src/orders/infrastructure/persistence/relational/mappers/order.mapper.ts`, `src/payments/domain/payment.ts`, `src/payments/infrastructure/persistence/relational/entities/payment.entity.ts`, `src/payments/infrastructure/persistence/relational/mappers/payment.mapper.ts`, beş yeni entity, `src/reviews/domain/{review,review-report}.ts`, `src/order-issues/domain/order-issue.ts`, `src/order-messages/domain/order-message.ts`, mapper'lar (`review`, `review-report`, `order-issue`, `order-message`)
- Modify: `src/kitchens/kitchens.service.ts`, `src/kitchens/infrastructure/persistence/kitchen.repository.ts`, `src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts`, `src/orders/order.fixture.ts`
- Test: `src/reviews/infrastructure/persistence/relational/mappers/review.mapper.spec.ts`
- Create (generate): `src/database/migrations/<timestamp>-CreateTrust.ts`

**Interfaces:**
- Consumes: Task 1 enum'ları, `FileSnapshot`/`toSnapshot`/`toFileType` (`src/catalog/file-snapshot.ts`), `FileMapper`, `PersonName` (`src/orders/domain/order.ts`), `KitchenEntity`, `OrderEntity`, `UserEntity`, `EntityRelationalHelper`.
- Produces:
  - `Kitchen.ratingAvg: number | null`, `Kitchen.ratingCount: number` (GET `/kitchens/me` de taşır); `KitchenRepository.create(data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt' | 'ratingAvg' | 'ratingCount'>)`; `KitchenRepository.update` puanı asla yazmaz.
  - `Order.customerLastReadAt: Date | null`, `Order.cookLastReadAt: Date | null` (`NewOrder` bunları içermez); `Payment.refundedKurus: number` (`NewPayment` içermez, DB default 0).
  - `class Review { id; orderId; kitchenId; authorId; rating; taste; portion; packaging; timing; tags: ReviewTag[]; comment; photos: FileType[]; reply; repliedAt; isHidden; author: ReviewAuthor; createdAt; updatedAt; deletedAt }`, `type ReviewAuthor = PersonName & { photo: FileType | null }`, `type NewReview = Pick<Review, 'orderId' | 'kitchenId' | 'authorId' | 'rating' | 'taste' | 'portion' | 'packaging' | 'timing' | 'tags' | 'comment' | 'photos'>`; `class ReviewReport { id; reviewId; reporterId; reason; note; review: Review; createdAt }`, `type NewReviewReport = Pick<ReviewReport, 'reviewId' | 'reporterId' | 'reason' | 'note'>`.
  - `class OrderIssue { id; orderId; reporterId; category; description; photos: FileType[]; requestedResolution; status; refundKurus; adminNote; resolvedAt; createdAt; updatedAt }`, `type NewOrderIssue`, `type OrderIssueResolution = Pick<OrderIssue, 'status' | 'refundKurus' | 'adminNote' | 'resolvedAt'>`.
  - `class OrderMessage { id; orderId; senderId; senderRole: MessageSide; body; createdAt }`, `type NewOrderMessage = Pick<OrderMessage, 'orderId' | 'senderId' | 'senderRole' | 'body'>`.
  - Entity'ler: `ReviewEntity` (`orderId` unique, index (`kitchenId`, `createdAt`), `authorId` index, `deletedAt`), `ReviewReportEntity` (unique (`reviewId`, `reporterId`)), `FavoriteEntity` (unique (`userId`, `kitchenId`)), `OrderIssueEntity` (index (`orderId`, `createdAt`), kısmi unique index **`IDX_order_issue_open_order`** `WHERE "status" = 'open'`), `OrderMessageEntity` (index (`orderId`, `createdAt`), `senderId` index, `createdAt timestamptz(3)`).
  - Mapper'lar: `ReviewMapper.toDomain(raw)` (`author` + `photo` join'li bekler) / `toPersistence(NewReview)`, `ReviewReportMapper.toDomain(raw)` (`review` join'li), `OrderIssueMapper.toDomain` / `toPersistence(NewOrderIssue)` (her zaman `status: open`), `OrderMessageMapper.toDomain` / `toPersistence`.

- [ ] **Step 1: Resource'ları ve alanları generator ile üret (sırayla, `set -e` olmadan)**

```bash
npm run generate:resource:relational -- --name Review
npm run generate:resource:relational -- --name ReviewReport
npm run generate:resource:relational -- --name Favorite
npm run generate:resource:relational -- --name OrderIssue
npm run generate:resource:relational -- --name OrderMessage

npm run add:property:to-relational -- --name Review --property order --kind reference --type Order --referenceType oneToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Review --property kitchen --kind reference --type Kitchen --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Review --property author --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Review --property rating --kind primitive --type number --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Review --property taste --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property portion --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property packaging --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property timing --kind primitive --type number --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property tags --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Review --property comment --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property photos --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Review --property reply --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property repliedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Review --property isHidden --kind primitive --type boolean --isAddToDto false --isOptional false

npm run add:property:to-relational -- --name ReviewReport --property review --kind reference --type Review --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name ReviewReport --property reporter --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name ReviewReport --property reason --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name ReviewReport --property note --kind primitive --type string --isAddToDto true --isOptional true --isNullable true

npm run add:property:to-relational -- --name Favorite --property user --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name Favorite --property kitchen --kind reference --type Kitchen --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false

npm run add:property:to-relational -- --name OrderIssue --property order --kind reference --type Order --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderIssue --property reporter --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderIssue --property category --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name OrderIssue --property description --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name OrderIssue --property photos --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderIssue --property requestedResolution --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name OrderIssue --property status --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderIssue --property refundKurus --kind primitive --type number --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name OrderIssue --property adminNote --kind primitive --type string --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name OrderIssue --property resolvedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true

npm run add:property:to-relational -- --name OrderMessage --property order --kind reference --type Order --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderMessage --property sender --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
npm run add:property:to-relational -- --name OrderMessage --property senderRole --kind primitive --type string --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name OrderMessage --property body --kind primitive --type string --isAddToDto true --isOptional false

npm run add:property:to-relational -- --name Kitchen --property ratingAvg --kind primitive --type number --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Kitchen --property ratingCount --kind primitive --type number --isAddToDto false --isOptional false
npm run add:property:to-relational -- --name Order --property customerLastReadAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Order --property cookLastReadAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name Payment --property refundedKurus --kind primitive --type number --isAddToDto false --isOptional false
```

(`photos` ve `tags` string olarak üretilir, Step 4'te `jsonb` / `simple-array` yapılır. Kitchen/Order/Payment alanları mevcut dosyalara enjekte edilir ve sözdizimini bozar — Step 2–3 düzeltir.)

Kontrol: `git status --short` → yeni `src/reviews/`, `src/review-reports/`, `src/favorites/`, `src/order-issues/`, `src/order-messages/`; değişmiş `src/app.module.ts`, `src/kitchens/{domain/kitchen.ts,dto/create-kitchen.dto.ts,infrastructure/…/kitchen.entity.ts,…/kitchen.mapper.ts,kitchens.service.ts}`, `src/orders/{domain/order.ts,dto/create-order.dto.ts,…/order.entity.ts,…/order.mapper.ts,orders.service.ts}`, `src/payments/{domain/payment.ts,…/payment.entity.ts,…/payment.mapper.ts,payments.service.ts}`. Başka bir mevcut dosya değiştiyse veya dosya adları bu listeyle eşleşmiyorsa DURUP kullanıcıya bildir.

- [ ] **Step 2: İskeleti temizle, enjekte edilen satırları geri al**

`review_report` yalnız değerlendirme modülünün okuyup yazdığı bir tablo (Faz 3'teki `order_item` gibi); yeni modüllerin controller/service/DTO/repository iskeletleri sonraki görevlerde amaca göre yazılır.

```bash
mv src/review-reports/infrastructure/persistence/relational/entities/review-report.entity.ts src/reviews/infrastructure/persistence/relational/entities/
rm -rf src/review-reports
for m in reviews favorites order-issues order-messages; do
  find src/$m -type f ! -name '*.entity.ts' -delete
  find src/$m -type d -empty -delete
done
git checkout -- src/app.module.ts src/kitchens/kitchens.service.ts src/kitchens/dto/create-kitchen.dto.ts src/orders/orders.service.ts src/orders/dto/create-order.dto.ts src/payments/payments.service.ts
```

Kontrol: `find src/reviews src/favorites src/order-issues src/order-messages -type f` → yalnız beş `*.entity.ts`.

- [ ] **Step 3: Mevcut tabloların yeni alanları**

Mutfak puanı türetilmiş bir alandır: yalnız değerlendirme transaction'ları yazar. `PATCH /kitchens/me` mutfağın tamamını okuyup geri kaydettiği için, eşzamanlı bir değerlendirmenin yazdığı puanın eski kopyayla ezilmemesi repository'de engellenir.

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

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tek ondalık; değerlendirme yoksa null',
  })
  ratingAvg: number | null;

  @ApiProperty({ type: Number })
  ratingCount: number;

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

  // Derived (ratingSummary) in the review transactions; never written by PATCH.
  @Column({ type: 'double precision', nullable: true })
  ratingAvg: number | null;

  @Column({ type: Number, default: 0 })
  ratingCount: number;

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
      minOrderKurus: raw.minOrderKurus,
      hours: raw.hours,
      isPaused: raw.isPaused,
      isVerified: raw.isVerified,
      ratingAvg: raw.ratingAvg,
      ratingCount: raw.ratingCount,
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

`src/kitchens/infrastructure/persistence/kitchen.repository.ts` — şu bloğu:

```ts
import { Kitchen } from '../../domain/kitchen';

export abstract class KitchenRepository {
  abstract create(
    data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Kitchen>;

  abstract findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>>;

  abstract findById(id: Kitchen['id']): Promise<NullableType<Kitchen>>;

  abstract update(
    id: Kitchen['id'],
    payload: Partial<Kitchen>,
```

şununla değiştir:

```ts
import { Kitchen } from '../../domain/kitchen';

export abstract class KitchenRepository {
  /** A new kitchen starts unrated (ratingAvg null, ratingCount 0). */
  abstract create(
    data: Omit<
      Kitchen,
      'id' | 'createdAt' | 'updatedAt' | 'ratingAvg' | 'ratingCount'
    >,
  ): Promise<Kitchen>;

  abstract findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>>;

  abstract findById(id: Kitchen['id']): Promise<NullableType<Kitchen>>;

  /** Never writes ratingAvg/ratingCount, even when `payload` carries them. */
  abstract update(
    id: Kitchen['id'],
    payload: Partial<Kitchen>,
```

`src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts` — şu bloğu:

```ts
  ) {}

  async create(
    data: Omit<Kitchen, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Kitchen> {
    const entity = await this.kitchenRepository.save(
      this.kitchenRepository.create(KitchenMapper.toPersistence(data)),
```

şununla değiştir:

```ts
  ) {}

  async create(
    data: Omit<
      Kitchen,
      'id' | 'createdAt' | 'updatedAt' | 'ratingAvg' | 'ratingCount'
    >,
  ): Promise<Kitchen> {
    const entity = await this.kitchenRepository.save(
      this.kitchenRepository.create(KitchenMapper.toPersistence(data)),
```

`src/kitchens/infrastructure/persistence/relational/repositories/kitchen.repository.ts` — ardından şu bloğu:

```ts
    await this.kitchenRepository.save(
      this.kitchenRepository.create({
        ...KitchenMapper.toPersistence(payload),
        id,
      }),
    );
```

şununla değiştir:

```ts
    await this.kitchenRepository.save(
      this.kitchenRepository.create({
        ...KitchenMapper.toPersistence(payload),
        // The review transactions own these; a stale copy must not overwrite them.
        ratingAvg: undefined,
        ratingCount: undefined,
        id,
      }),
    );
```

`src/kitchens/kitchens.service.ts` — şu bloğu:

```ts
import { KitchenRepository } from './infrastructure/persistence/kitchen.repository';
import { deliveryRadiusOf, kitchenRuleErrors } from './kitchen-rules';

/** What the cook controls; deliveryRadiusKm and searchText derive from it. */
type KitchenFields = Omit<
  Kitchen,
  'id' | 'createdAt' | 'updatedAt' | 'deliveryRadiusKm' | 'searchText'
>;

const addressFields = (address: Address) => ({
```

şununla değiştir:

```ts
import { KitchenRepository } from './infrastructure/persistence/kitchen.repository';
import { deliveryRadiusOf, kitchenRuleErrors } from './kitchen-rules';

/**
 * What the cook controls; deliveryRadiusKm and searchText derive from it.
 * The rating is the reviews' (ReviewRepository recomputes it).
 */
type KitchenFields = Omit<
  Kitchen,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deliveryRadiusKm'
  | 'searchText'
  | 'ratingAvg'
  | 'ratingCount'
>;

const addressFields = (address: Address) => ({
```

Sipariş okuma işaretleri (mesajlaşma, Task 6) ve ödemenin iade toplamı (Task 5):

`src/orders/domain/order.ts` — dosyanın tamamı:

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

  /** Chat read markers: the side's unread messages are the other side's after it. */
  customerLastReadAt: Date | null;

  cookLastReadAt: Date | null;

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
  | 'id'
  | 'code'
  | 'items'
  | 'kitchen'
  | 'customer'
  | 'customerLastReadAt'
  | 'cookLastReadAt'
  | 'createdAt'
  | 'updatedAt'
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

  @Column({ type: 'timestamptz', nullable: true })
  customerLastReadAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cookLastReadAt: Date | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: OrderItemEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
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
      customerLastReadAt: raw.customerLastReadAt,
      cookLastReadAt: raw.cookLastReadAt,
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

`src/orders/order.fixture.ts` — şu bloğu:

```ts
    closedAt: null,
    cancelledBy: null,
    reason: null,
    items: [anItem()],
    kitchen: {
      id: 'k1',
```

şununla değiştir:

```ts
    closedAt: null,
    cancelledBy: null,
    reason: null,
    customerLastReadAt: null,
    cookLastReadAt: null,
    items: [anItem()],
    kitchen: {
      id: 'k1',
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

  /** Given back so far; a full refund sets it to amountKurus, partial refunds add up to it. */
  refundedKurus: number;

  status: PaymentStatus;

  paidAt: Date | null;

  refundedAt: Date | null;

  createdAt: Date;

  updatedAt: Date;
}

export type NewPayment = Omit<
  Payment,
  'id' | 'refundedKurus' | 'createdAt' | 'updatedAt'
>;
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

  @Column({ type: Number, default: 0 })
  refundedKurus: number;

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
      refundedKurus: raw.refundedKurus,
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

Run: `npx tsc --noEmit -p tsconfig.json && npx jest src/kitchens src/orders src/payments` → tip hatası yok, PASS.

- [ ] **Step 4: Yeni entity'ler**

`src/reviews/infrastructure/persistence/relational/entities/review.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { ReviewTag } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'review',
})
@Index(['kitchenId', 'createdAt'])
export class ReviewEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One review per order, deleted ones included: the join column is unique.
  @OneToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Column({ type: 'uuid' })
  kitchenId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'authorId' })
  author?: UserEntity;

  @Index()
  @Column({ type: Number })
  authorId: number;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'smallint', nullable: true })
  taste: number | null;

  @Column({ type: 'smallint', nullable: true })
  portion: number | null;

  @Column({ type: 'smallint', nullable: true })
  packaging: number | null;

  @Column({ type: 'smallint', nullable: true })
  timing: number | null;

  @Column({ type: 'simple-array', default: '' })
  tags: ReviewTag[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  comment: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: FileSnapshot[];

  @Column({ type: 'varchar', length: 300, nullable: true })
  reply: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  repliedAt: Date | null;

  @Column({ type: Boolean, default: false })
  isHidden: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
```

`src/reviews/infrastructure/persistence/relational/entities/review-report.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ReviewReportReason } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { ReviewEntity } from './review.entity';

/** A cook flagging a review of their kitchen; once per review and cook. */
@Entity({
  name: 'review_report',
})
@Unique(['reviewId', 'reporterId'])
export class ReviewReportEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ReviewEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'reviewId' })
  review?: ReviewEntity;

  @Column({ type: 'uuid' })
  reviewId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'reporterId' })
  reporter?: UserEntity;

  @Column({ type: Number })
  reporterId: number;

  @Column({ type: String })
  reason: ReviewReportReason;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

`src/favorites/infrastructure/persistence/relational/entities/favorite.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

/** A customer following a kitchen (kitchens only, never products). */
@Entity({
  name: 'favorite',
})
@Unique(['userId', 'kitchenId'])
export class FavoriteEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @Column({ type: Number })
  userId: number;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Column({ type: 'uuid' })
  kitchenId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

`src/order-issues/infrastructure/persistence/relational/entities/order-issue.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'order_issue',
})
@Index(['orderId', 'createdAt'])
// One open report per order; resolved and rejected ones pile up beside it.
@Index('IDX_order_issue_open_order', ['orderId'], {
  unique: true,
  where: `"status" = 'open'`,
})
export class OrderIssueEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'reporterId' })
  reporter?: UserEntity;

  @Column({ type: Number })
  reporterId: number;

  @Column({ type: String })
  category: IssueCategory;

  @Column({ type: 'varchar', length: 1000 })
  description: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: FileSnapshot[];

  @Column({ type: String })
  requestedResolution: IssueResolution;

  @Column({ type: String })
  status: IssueStatus;

  @Column({ type: Number, nullable: true })
  refundKurus: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  adminNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

`src/order-messages/infrastructure/persistence/relational/entities/order-message.entity.ts` — dosyanın tamamı:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { MessageSide } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'order_message',
})
@Index(['orderId', 'createdAt'])
export class OrderMessageEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'senderId' })
  sender?: UserEntity;

  @Index()
  @Column({ type: Number })
  senderId: number;

  @Column({ type: String })
  senderRole: MessageSide;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  // Millisecond precision: the client polls with `after` = the last
  // createdAt it saw (JSON keeps milliseconds), so stored values must match.
  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt: Date;
}
```

- [ ] **Step 5: Domain sınıfları**

Favori için domain sınıfı yok: favori repository'si (Task 4) mutfakları döner.

`src/reviews/domain/review.ts` — dosyanın tamamı:

```ts
import { FileType } from '../../files/domain/file';
import { Kitchen } from '../../kitchens/domain/kitchen';
import { Order, PersonName } from '../../orders/domain/order';
import { ReviewTag } from '../../trust/trust.enums';
import { User } from '../../users/domain/user';

export type ReviewAuthor = PersonName & { photo: FileType | null };

/** A customer's review of a completed order; cannot be edited, only deleted. */
export class Review {
  id: string;

  orderId: Order['id'];

  kitchenId: Kitchen['id'];

  authorId: User['id'];

  /** 1–5; the only part that counts towards the kitchen's rating. */
  rating: number;

  taste: number | null;

  portion: number | null;

  packaging: number | null;

  timing: number | null;

  tags: ReviewTag[];

  comment: string | null;

  photos: FileType[];

  /** The cook's answer. */
  reply: string | null;

  repliedAt: Date | null;

  /** Hidden by an admin: out of the public list and the rating. */
  isHidden: boolean;

  author: ReviewAuthor;

  createdAt: Date;

  updatedAt: Date;

  deletedAt: Date | null;
}

export type NewReview = Pick<
  Review,
  | 'orderId'
  | 'kitchenId'
  | 'authorId'
  | 'rating'
  | 'taste'
  | 'portion'
  | 'packaging'
  | 'timing'
  | 'tags'
  | 'comment'
  | 'photos'
>;
```

`src/reviews/domain/review-report.ts` — dosyanın tamamı:

```ts
import { ReviewReportReason } from '../../trust/trust.enums';
import { User } from '../../users/domain/user';
import { Review } from './review';

/** A cook's report of a review; an admin decides whether to hide it. */
export class ReviewReport {
  id: string;

  reviewId: Review['id'];

  reporterId: User['id'];

  reason: ReviewReportReason;

  note: string | null;

  /** The reported review, hidden or not. */
  review: Review;

  createdAt: Date;
}

export type NewReviewReport = Pick<
  ReviewReport,
  'reviewId' | 'reporterId' | 'reason' | 'note'
>;
```

`src/order-issues/domain/order-issue.ts` — dosyanın tamamı:

```ts
import { FileType } from '../../files/domain/file';
import { Order } from '../../orders/domain/order';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../../trust/trust.enums';
import { User } from '../../users/domain/user';

/** A customer's report of a problem with an order; kept when the account goes. */
export class OrderIssue {
  id: string;

  orderId: Order['id'];

  reporterId: User['id'];

  category: IssueCategory;

  description: string;

  photos: FileType[];

  requestedResolution: IssueResolution;

  status: IssueStatus;

  /** The refund applied when it was resolved. */
  refundKurus: number | null;

  /** Shown to the customer and the cook. */
  adminNote: string | null;

  resolvedAt: Date | null;

  createdAt: Date;

  updatedAt: Date;
}

export type NewOrderIssue = Pick<
  OrderIssue,
  | 'orderId'
  | 'reporterId'
  | 'category'
  | 'description'
  | 'photos'
  | 'requestedResolution'
>;

/** What an admin's decision writes. */
export type OrderIssueResolution = Pick<
  OrderIssue,
  'status' | 'refundKurus' | 'adminNote' | 'resolvedAt'
>;
```

`src/order-messages/domain/order-message.ts` — dosyanın tamamı:

```ts
import { Order } from '../../orders/domain/order';
import { MessageSide } from '../../trust/trust.enums';
import { User } from '../../users/domain/user';

/** A line of an order's chat between the customer and the cook. */
export class OrderMessage {
  id: string;

  orderId: Order['id'];

  senderId: User['id'];

  senderRole: MessageSide;

  body: string;

  createdAt: Date;
}

export type NewOrderMessage = Pick<
  OrderMessage,
  'orderId' | 'senderId' | 'senderRole' | 'body'
>;
```

- [ ] **Step 6: Mapper — test**

`src/reviews/infrastructure/persistence/relational/mappers/review.mapper.spec.ts` — dosyanın tamamı:

```ts
import { FileType } from '../../../../../files/domain/file';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { ReviewTag } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewMapper } from './review.mapper';

const CREATED = new Date('2026-10-12T09:30:00Z');

const entity = (overrides: Partial<ReviewEntity> = {}): ReviewEntity =>
  Object.assign(new ReviewEntity(), {
    id: 'r1',
    orderId: 'o1',
    kitchenId: 'k1',
    authorId: 9,
    rating: 5,
    taste: 5,
    portion: null,
    packaging: null,
    timing: 4,
    tags: [ReviewTag.homemade, ReviewTag.arrivedHot],
    comment: 'Annemin mantısı gibi',
    photos: [{ id: 'f1', path: '/f1.png' }],
    reply: null,
    repliedAt: null,
    isHidden: false,
    author: Object.assign(new UserEntity(), {
      firstName: 'Deniz',
      lastName: 'Arslan',
      photo: Object.assign(new FileEntity(), { id: 'u1', path: '/u1.png' }),
    }),
    createdAt: CREATED,
    updatedAt: CREATED,
    deletedAt: null,
    ...overrides,
  });

describe('ReviewMapper', () => {
  it('should turn photo snapshots into files and carry the author', () => {
    const review = ReviewMapper.toDomain(entity());

    expect(review.photos[0]).toBeInstanceOf(FileType);
    expect(review).toMatchObject({
      rating: 5,
      taste: 5,
      portion: null,
      tags: ['homemade', 'arrived_hot'],
      author: {
        firstName: 'Deniz',
        lastName: 'Arslan',
        photo: { id: 'u1', path: '/u1.png' },
      },
    });
  });

  it('should cope with an anonymized author', () => {
    const review = ReviewMapper.toDomain(
      entity({
        author: Object.assign(new UserEntity(), {
          firstName: null,
          lastName: null,
          photo: null,
        }),
      }),
    );

    expect(review.author).toEqual({
      firstName: null,
      lastName: null,
      photo: null,
    });
  });

  it('should store files as snapshots and the author id as a number', () => {
    const row = ReviewMapper.toPersistence({
      orderId: 'o1',
      kitchenId: 'k1',
      authorId: '9',
      rating: 4,
      taste: null,
      portion: null,
      packaging: null,
      timing: null,
      tags: [],
      comment: null,
      photos: [Object.assign(new FileType(), { id: 'f1', path: '/f1.png' })],
    });

    expect(row).toMatchObject({
      authorId: 9,
      photos: [{ id: 'f1', path: '/f1.png' }],
    });
    expect(row.photos[0]).not.toBeInstanceOf(FileType);
  });
});
```

Run: `npx jest src/reviews` → FAIL (`Cannot find module './review.mapper'`).

- [ ] **Step 7: Mapper'lar — kod**

`src/reviews/infrastructure/persistence/relational/mappers/review.mapper.ts` — dosyanın tamamı:

```ts
import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { FileMapper } from '../../../../../files/infrastructure/persistence/relational/mappers/file.mapper';
import { NewReview, Review } from '../../../../domain/review';
import { ReviewEntity } from '../entities/review.entity';

export class ReviewMapper {
  /** Expects `author` joined (withDeleted) — ReviewRelationalRepository always does. */
  static toDomain(raw: ReviewEntity): Review {
    return Object.assign(new Review(), {
      id: raw.id,
      orderId: raw.orderId,
      kitchenId: raw.kitchenId,
      authorId: raw.authorId,
      rating: raw.rating,
      taste: raw.taste,
      portion: raw.portion,
      packaging: raw.packaging,
      timing: raw.timing,
      tags: raw.tags,
      comment: raw.comment,
      photos: raw.photos.map(toFileType),
      reply: raw.reply,
      repliedAt: raw.repliedAt,
      isHidden: raw.isHidden,
      author: {
        firstName: raw.author?.firstName ?? null,
        lastName: raw.author?.lastName ?? null,
        photo: raw.author?.photo ? FileMapper.toDomain(raw.author.photo) : null,
      },
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt,
    });
  }

  static toPersistence(review: NewReview): ReviewEntity {
    return Object.assign(new ReviewEntity(), {
      ...review,
      authorId: Number(review.authorId),
      photos: review.photos.map(toSnapshot),
    });
  }
}
```

`src/reviews/infrastructure/persistence/relational/mappers/review-report.mapper.ts` — dosyanın tamamı:

```ts
import { ReviewReport } from '../../../../domain/review-report';
import { ReviewReportEntity } from '../entities/review-report.entity';
import { ReviewMapper } from './review.mapper';

export class ReviewReportMapper {
  /** Expects `review` (+ its author) joined. */
  static toDomain(raw: ReviewReportEntity): ReviewReport {
    return Object.assign(new ReviewReport(), {
      id: raw.id,
      reviewId: raw.reviewId,
      reporterId: raw.reporterId,
      reason: raw.reason,
      note: raw.note,
      review: ReviewMapper.toDomain(
        raw.review as NonNullable<typeof raw.review>,
      ),
      createdAt: raw.createdAt,
    });
  }
}
```

`src/order-issues/infrastructure/persistence/relational/mappers/order-issue.mapper.ts` — dosyanın tamamı:

```ts
import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { IssueStatus } from '../../../../../trust/trust.enums';
import { NewOrderIssue, OrderIssue } from '../../../../domain/order-issue';
import { OrderIssueEntity } from '../entities/order-issue.entity';

export class OrderIssueMapper {
  static toDomain(raw: OrderIssueEntity): OrderIssue {
    return Object.assign(new OrderIssue(), {
      id: raw.id,
      orderId: raw.orderId,
      reporterId: raw.reporterId,
      category: raw.category,
      description: raw.description,
      photos: raw.photos.map(toFileType),
      requestedResolution: raw.requestedResolution,
      status: raw.status,
      refundKurus: raw.refundKurus,
      adminNote: raw.adminNote,
      resolvedAt: raw.resolvedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  /** A new report is always open. */
  static toPersistence(issue: NewOrderIssue): OrderIssueEntity {
    return Object.assign(new OrderIssueEntity(), {
      ...issue,
      reporterId: Number(issue.reporterId),
      photos: issue.photos.map(toSnapshot),
      status: IssueStatus.open,
    });
  }
}
```

`src/order-messages/infrastructure/persistence/relational/mappers/order-message.mapper.ts` — dosyanın tamamı:

```ts
import {
  NewOrderMessage,
  OrderMessage,
} from '../../../../domain/order-message';
import { OrderMessageEntity } from '../entities/order-message.entity';

export class OrderMessageMapper {
  static toDomain(raw: OrderMessageEntity): OrderMessage {
    return Object.assign(new OrderMessage(), {
      id: raw.id,
      orderId: raw.orderId,
      senderId: raw.senderId,
      senderRole: raw.senderRole,
      body: raw.body,
      createdAt: raw.createdAt,
    });
  }

  static toPersistence(message: NewOrderMessage): OrderMessageEntity {
    return Object.assign(new OrderMessageEntity(), {
      ...message,
      senderId: Number(message.senderId),
    });
  }
}
```

Run: `npx jest src/reviews && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: PASS (3 test), tip hatası yok, lint temiz. (Dev API yeniden başlar; yeni tablolar henüz yok ama hiçbir modül onları okumuyor.)

- [ ] **Step 8: Migration**

```bash
npm run migration:generate -- src/database/migrations/CreateTrust
```

Expected: `CREATE TABLE "review"` (`orderId` unique `REL_…`, `rating`…`timing` `smallint`, `tags text NOT NULL DEFAULT ''`, `comment character varying(500)`, `photos jsonb NOT NULL DEFAULT '[]'`, `reply character varying(300)`, `isHidden boolean NOT NULL DEFAULT false`, `deletedAt TIMESTAMP WITH TIME ZONE`), index'ler `("authorId")`, `("kitchenId", "createdAt")`; `CREATE TABLE "review_report"` (unique `("reviewId", "reporterId")`, `note character varying(300)`); `CREATE TABLE "order_message"` (`body character varying(500)`, `createdAt TIMESTAMP(3) WITH TIME ZONE`), index'ler `("senderId")`, `("orderId", "createdAt")`; `CREATE TABLE "order_issue"` (`description character varying(1000)`, `adminNote character varying(500)`, `refundKurus integer`), `CREATE UNIQUE INDEX "IDX_order_issue_open_order" ON "order_issue" ("orderId") WHERE "status" = 'open'`, index `("orderId", "createdAt")`; `CREATE TABLE "favorite"` (unique `("userId", "kitchenId")`); `ALTER TABLE "kitchen" ADD "ratingAvg" double precision`, `ADD "ratingCount" integer NOT NULL DEFAULT '0'`; `ALTER TABLE "order" ADD "customerLastReadAt"`, `ADD "cookLastReadAt"` (`TIMESTAMP WITH TIME ZONE`); `ALTER TABLE "payment" ADD "refundedKurus" integer NOT NULL DEFAULT '0'`; on bir FK. Başka bir mevcut tabloya dokunan ifade varsa DURUP kullanıcıya bildir.

Oluşan dosyada `up()` metodunun **son** `await queryRunner.query(…)` çağrısından sonra (kapanan `}`'dan önce) şu satırları ekle — Faz 3'te iade edilmiş ödemeler parayı tamamen geri vermişti, yeni sütun bunu söylemeli:

```ts
    // Hand-added: payments refunded before Faz 4 gave everything back.
    await queryRunner.query(
      `UPDATE "payment" SET "refundedKurus" = "amountKurus" WHERE "status" = 'refunded'`,
    );
```

```bash
npm run lint -- --fix
npm run migration:run
```

- [ ] **Step 9: Elle doğrula**

Run: `PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2-) psql -h localhost -U sofram -d sofram -c '\d order_issue' -c "SELECT status, COUNT(*), COUNT(*) FILTER (WHERE \"refundedKurus\" = \"amountKurus\") AS full FROM payment GROUP BY status"`
Expected: `order_issue` üzerinde `"IDX_order_issue_open_order" UNIQUE, btree ("orderId") WHERE status::text = 'open'::text`; `refunded` satırlarında `full` = sayı, `paid` satırlarında 0.

Run: `npm run migration:generate -- src/database/migrations/Check`
Expected: "No changes in database schema were found" (dosya oluşmaz).

- [ ] **Step 10: Commit**

Run: `npm test && npm run test:e2e -- --runInBand` → PASS (şema değişikliği mevcut akışları bozmaz).

```bash
git add src/reviews src/favorites src/order-issues src/order-messages src/kitchens src/orders src/payments src/database/migrations
git commit -m "feat(trust): add review, favorite, issue and message tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Değerlendirmeler (müşteri, aşçı, admin) ve puanın aynı transaction'da hesaplanması

**Files:**
- Modify: `src/orders/orders.module.ts` (persistence modülünü dışa açar), `src/orders/dto/list-orders.dto.ts` (`PageQueryDto` export), `src/app.module.ts`
- Create: `src/reviews/infrastructure/persistence/review.repository.ts`, `src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts`, `src/reviews/infrastructure/persistence/relational/relational-persistence.module.ts`
- Create: `src/reviews/dto/create-review.dto.ts`, `src/reviews/dto/review-actions.dto.ts`, `src/reviews/dto/list-reviews.dto.ts`, `src/reviews/views.ts`, `src/reviews/presenters.ts`, `src/reviews/review.fixture.ts`, `src/reviews/reviews.service.ts`, `src/reviews/reviews.controller.ts`, `src/reviews/cook-reviews.controller.ts`, `src/reviews/admin-reviews.controller.ts`, `src/reviews/reviews.module.ts`
- Test: `src/reviews/presenters.spec.ts`, `src/reviews/reviews.service.spec.ts`, `test/user/reviews.e2e-spec.ts`
- Modify: `test/utils/orders.ts` (`uploadPhoto`, `adminLogin`, `placeOrder`, `cookStep`, `completeOrder`)

**Interfaces:**
- Consumes: Task 1 (`canReview`, `ratingSummary`, `topTags`, `RatingGroup`, `reviewNotAllowed`, `reviewExists`, `reviewAlreadyReported`, `photosByIds`, `ReviewTag`, `ReviewReportReason`, `ReviewFilter`, `trust.reviewWindowDays`), Task 2 (`Review`, `NewReview`, `ReviewReport`, `NewReviewReport`, `ReviewEntity`, `ReviewReportEntity`, `ReviewMapper`, `ReviewReportMapper`, `KitchenEntity.ratingAvg/ratingCount`), `OrderRepository.findForCustomer` (`src/orders/infrastructure/persistence/order.repository.ts`), `KitchensService.findById/findMine/findByOwner`, `FilesService`, `shortName` (`src/orders/presenters.ts`), `infinityPagination`, `orNotFound`, `Roles`/`RolesGuard`/`RoleEnum`.
- Produces:
  - `OrdersModule` artık `RelationalOrderPersistenceModule`'ü (dolayısıyla `OrderRepository`'yi) dışa açar; `export class PageQueryDto { page = 1 (1–1000); limit = 20 (1–50) }`.
  - `ReviewRepository` (port): `create(review: NewReview): Promise<Review>` (mutfak satırı `FOR UPDATE`, insert, puan yeniden hesap — tek transaction; aynı sipariş → `DuplicateReviewError`), `findById(id)`, `findForAuthor(authorId, id)`, `findForKitchen(kitchenId, id)` (silinmemiş, gizliler dahil), `findByOrderIds(orderIds: string[]): Promise<Review[]>` (**silinmişler dahil**), `listVisible(kitchenId, page: ReviewPage)`, `listForKitchen(kitchenId, filter: ReviewFilter, page)`, `ratingGroups(kitchenId): Promise<RatingGroup[]>`, `tagCounts(kitchenId): Promise<TagCount[]>`, `softDelete(id)`, `setHidden(id, isHidden): Promise<Review>` (ikisi de puanı yeniden hesaplar), `setReply(id, reply: string | null): Promise<Review>`, `addReport(report: NewReviewReport)` (`DuplicateReviewReportError`), `listReports(page): Promise<ReviewReport[]>`; tipler `ReviewPage = { offset; limit }`, `TagCount = { tag: ReviewTag; count: number }`.
  - `ReviewsService`: `create(customerId, orderId, dto: CreateReviewDto): Promise<OrderReviewView>`, `remove(authorId, id)`, `kitchenReviews(kitchenId, query: PageQueryDto): Promise<KitchenReviewsPage>`, `listMine(ownerId, query: ListCookReviewsQueryDto)`, `reply(ownerId, id, reply: string): Promise<KitchenReviewView>`, `removeReply(ownerId, id)`, `report(ownerId, id, dto: ReportReviewDto)`, `listReports(query: PageQueryDto)`, `setHidden(id, isHidden): Promise<KitchenReviewView>`.
  - Görünümler: `OrderReviewView { id, rating, taste, portion, packaging, timing, tags, comment, photos, reply, repliedAt, createdAt }` (Task 6 sipariş detayında da kullanılır), `ReviewView` (+ `authorName` "Ad S.", `authorPhoto`), `KitchenReviewView` (+ `orderId`, `kitchenId`, `isHidden`), `ReviewsSummaryView { ratingAvg, ratingCount, distribution: {1..5}, topTags }`, `KitchenReviewsPage { data, hasNextPage, summary }`, `ReviewReportView { id, reason, note, createdAt, review }`; presenter'lar `orderReviewView(review)`, `reviewView`, `kitchenReviewView`, `reviewReportView(report)`, `reviewsSummary(groups, tags)`.
  - Uçlar: `POST /orders/:id/review` (201), `DELETE /reviews/:id` (204), `GET /discover/kitchens/:id/reviews?page&limit`, `GET /kitchens/me/reviews?page&limit&filter`, `PUT /kitchens/me/reviews/:id/reply` (200), `DELETE /kitchens/me/reviews/:id/reply` (204), `POST /kitchens/me/reviews/:id/report` (204), `GET /admin/review-reports?page&limit`, `PATCH /admin/reviews/:id { isHidden }` (200).
  - e2e yardımcıları: `uploadPhoto(token): Promise<string>`, `adminLogin(): Promise<string>`, `type Cart`, `type PlacedOrder = { id; pickupCode; totalKurus }`, `placeOrder(token, cart): Promise<PlacedOrder>` (teklif → teklifteki tutarla sipariş), `cookStep(token, orderId, action, body?)`, `completeOrder(cook, customer, cart): Promise<string>`.

- [ ] **Step 1: Sipariş repository'sini ve sayfalama DTO'sunu paylaş**

Değerlendirme, sorun ve mesaj modülleri siparişi sahibine göre `OrderRepository` ile bulur (`OrdersService`'in yaptığı gibi); `OrdersModule` bu modülleri import etmez, döngü yok.

`src/orders/orders.module.ts` — dosyanın sonundaki şu bloğu:

```ts
    OrderLifecycleService,
    OrdersExpiryTask,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
```

şununla değiştir:

```ts
    OrderLifecycleService,
    OrdersExpiryTask,
  ],
  exports: [OrdersService, RelationalOrderPersistenceModule],
})
export class OrdersModule {}
```

`src/orders/dto/list-orders.dto.ts` — şu bloğu:

```ts
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CookTab, OrderScope } from '../order.enums';

class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
```

şununla değiştir:

```ts
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CookTab, OrderScope } from '../order.enums';

/** page ≤ 1000, limit ≤ 50 (Faz 2 §8); shared by every infinite list. */
export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
```

- [ ] **Step 2: Repository**

Puanı değiştiren her yazım önce mutfak satırını `FOR UPDATE` kilitler: READ COMMITTED'da iki eşzamanlı değerlendirme birbirinin satırını görmeden sayıp son yazanın eksik puanı bırakmasını engeller. `ratingGroupsOf` silinmiş ve gizli satırları da gruplar; hangilerinin sayılacağına `ratingSummary` karar verir.

`src/reviews/infrastructure/persistence/review.repository.ts` — dosyanın tamamı:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { Order } from '../../../orders/domain/order';
import { RatingGroup } from '../../../trust/trust-rules';
import { ReviewFilter, ReviewTag } from '../../../trust/trust.enums';
import { User } from '../../../users/domain/user';
import { NullableType } from '../../../utils/types/nullable.type';
import { NewReview, Review } from '../../domain/review';
import { NewReviewReport, ReviewReport } from '../../domain/review-report';

export type ReviewPage = { offset: number; limit: number };

export type TagCount = { tag: ReviewTag; count: number };

/** The order already has a review — deleted ones included (unique orderId). */
export class DuplicateReviewError extends Error {}

/** This cook already reported this review (unique reviewId + reporterId). */
export class DuplicateReviewReportError extends Error {}

/**
 * Reviews and the kitchen rating they feed. Every write that changes which
 * reviews count (create, delete, hide) locks the kitchen row and recomputes
 * `kitchen.ratingAvg` / `ratingCount` in the same transaction.
 */
export abstract class ReviewRepository {
  /** DuplicateReviewError when the order already has one. */
  abstract create(review: NewReview): Promise<Review>;

  /** Not deleted; hidden included. */
  abstract findById(id: Review['id']): Promise<NullableType<Review>>;

  /** Not deleted; hidden included. */
  abstract findForAuthor(
    authorId: User['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>>;

  /** Not deleted; hidden included. */
  abstract findForKitchen(
    kitchenId: Kitchen['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>>;

  /** The reviews of these orders, deleted ones included (they still block a new one). */
  abstract findByOrderIds(orderIds: Order['id'][]): Promise<Review[]>;

  /** Not hidden, not deleted; newest first. */
  abstract listVisible(
    kitchenId: Kitchen['id'],
    page: ReviewPage,
  ): Promise<Review[]>;

  /** The cook's list: hidden ones included; newest first. */
  abstract listForKitchen(
    kitchenId: Kitchen['id'],
    filter: ReviewFilter,
    page: ReviewPage,
  ): Promise<Review[]>;

  /** Every review of the kitchen grouped by star, visibility and deletion. */
  abstract ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]>;

  /** How often each tag was picked in visible reviews. */
  abstract tagCounts(kitchenId: Kitchen['id']): Promise<TagCount[]>;

  /** Soft delete + rating recompute. */
  abstract softDelete(id: Review['id']): Promise<void>;

  /** + rating recompute; returns the updated review. */
  abstract setHidden(id: Review['id'], isHidden: boolean): Promise<Review>;

  /** null clears the reply. */
  abstract setReply(id: Review['id'], reply: string | null): Promise<Review>;

  /** DuplicateReviewReportError on a second report by the same cook. */
  abstract addReport(report: NewReviewReport): Promise<void>;

  /** Reports of reviews that are not deleted; newest first. */
  abstract listReports(page: ReviewPage): Promise<ReviewReport[]>;
}
```

`src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindOptionsRelations,
  FindOptionsWhere,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { Order } from '../../../../../orders/domain/order';
import { RatingGroup, ratingSummary } from '../../../../../trust/trust-rules';
import { ReviewFilter } from '../../../../../trust/trust.enums';
import { User } from '../../../../../users/domain/user';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { NewReview, Review } from '../../../../domain/review';
import {
  NewReviewReport,
  ReviewReport,
} from '../../../../domain/review-report';
import {
  DuplicateReviewError,
  DuplicateReviewReportError,
  ReviewPage,
  ReviewRepository,
  TagCount,
} from '../../review.repository';
import { ReviewReportEntity } from '../entities/review-report.entity';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewReportMapper } from '../mappers/review-report.mapper';
import { ReviewMapper } from '../mappers/review.mapper';

/** Everything ReviewMapper.toDomain reads. */
const RELATIONS: FindOptionsRelations<ReviewEntity> = {
  author: { photo: true },
};

const NEWEST_FIRST = { createdAt: 'DESC', id: 'DESC' } as const;

const isUniqueViolation = (error: unknown, table: string): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string }).code === '23505' &&
  (error.driverError as { table?: string }).table === table;

/** Grouped exactly as ratingSummary() expects; deleted rows included on purpose. */
async function ratingGroupsOf(
  manager: EntityManager,
  kitchenId: Kitchen['id'],
): Promise<RatingGroup[]> {
  const rows = await manager
    .createQueryBuilder(ReviewEntity, 'r')
    .withDeleted()
    .select('r.rating', 'rating')
    .addSelect('r."isHidden"', 'isHidden')
    .addSelect('r."deletedAt" IS NOT NULL', 'isDeleted')
    .addSelect('COUNT(*)', 'count')
    .where('r."kitchenId" = :kitchenId', { kitchenId })
    .groupBy('r.rating')
    .addGroupBy('r."isHidden"')
    .addGroupBy('r."deletedAt" IS NOT NULL')
    .getRawMany<{
      rating: number;
      isHidden: boolean;
      isDeleted: boolean;
      count: string;
    }>();

  return rows.map((row) => ({
    rating: Number(row.rating),
    isHidden: row.isHidden,
    isDeleted: row.isDeleted,
    count: Number(row.count),
  }));
}

@Injectable()
export class ReviewRelationalRepository implements ReviewRepository {
  constructor(
    @InjectRepository(ReviewEntity)
    private readonly reviews: Repository<ReviewEntity>,
    @InjectRepository(ReviewReportEntity)
    private readonly reports: Repository<ReviewReportEntity>,
  ) {}

  async create(review: NewReview): Promise<Review> {
    let id: string;

    try {
      id = await this.reviews.manager.transaction(async (manager) => {
        await this.lockKitchen(manager, review.kitchenId);
        const { identifiers } = await manager.insert(
          ReviewEntity,
          ReviewMapper.toPersistence(review),
        );
        await this.recompute(manager, review.kitchenId);
        return identifiers[0].id as string;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'review')) {
        throw new DuplicateReviewError();
      }

      throw error;
    }

    return this.findOneOrFail(id);
  }

  findById(id: Review['id']): Promise<NullableType<Review>> {
    return this.findOneWhere({ id });
  }

  findForAuthor(
    authorId: User['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>> {
    return this.findOneWhere({ id, authorId: Number(authorId) });
  }

  findForKitchen(
    kitchenId: Kitchen['id'],
    id: Review['id'],
  ): Promise<NullableType<Review>> {
    return this.findOneWhere({ id, kitchenId });
  }

  async findByOrderIds(orderIds: Order['id'][]): Promise<Review[]> {
    if (orderIds.length === 0) {
      return [];
    }

    const entities = await this.reviews.find({
      where: { orderId: In(orderIds) },
      withDeleted: true,
    });
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  async listVisible(
    kitchenId: Kitchen['id'],
    page: ReviewPage,
  ): Promise<Review[]> {
    const entities = await this.reviews.find({
      where: { kitchenId, isHidden: false },
      relations: RELATIONS,
      order: NEWEST_FIRST,
      skip: page.offset,
      take: page.limit,
    });
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  async listForKitchen(
    kitchenId: Kitchen['id'],
    filter: ReviewFilter,
    page: ReviewPage,
  ): Promise<Review[]> {
    const entities = await this.reviews.find({
      where: {
        kitchenId,
        ...(filter === ReviewFilter.unreplied ? { reply: IsNull() } : {}),
      },
      relations: RELATIONS,
      order: NEWEST_FIRST,
      skip: page.offset,
      take: page.limit,
    });
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]> {
    return ratingGroupsOf(this.reviews.manager, kitchenId);
  }

  async tagCounts(kitchenId: Kitchen['id']): Promise<TagCount[]> {
    const rows = await this.reviews.manager.query<
      { tag: TagCount['tag']; count: string }[]
    >(
      `SELECT t.tag, COUNT(*) AS count
       FROM "review" r, unnest(string_to_array(r."tags", ',')) AS t(tag)
       WHERE r."kitchenId" = $1 AND r."deletedAt" IS NULL AND NOT r."isHidden"
       GROUP BY t.tag`,
      [kitchenId],
    );

    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  async softDelete(id: Review['id']): Promise<void> {
    await this.reviews.manager.transaction(async (manager) => {
      const review = await manager.findOneOrFail(ReviewEntity, {
        where: { id },
      });
      await this.lockKitchen(manager, review.kitchenId);
      await manager.softDelete(ReviewEntity, { id });
      await this.recompute(manager, review.kitchenId);
    });
  }

  async setHidden(id: Review['id'], isHidden: boolean): Promise<Review> {
    await this.reviews.manager.transaction(async (manager) => {
      const review = await manager.findOneOrFail(ReviewEntity, {
        where: { id },
      });
      await this.lockKitchen(manager, review.kitchenId);
      await manager.update(ReviewEntity, { id }, { isHidden });
      await this.recompute(manager, review.kitchenId);
    });

    return this.findOneOrFail(id);
  }

  async setReply(id: Review['id'], reply: string | null): Promise<Review> {
    await this.reviews.update(
      { id },
      { reply, repliedAt: reply === null ? null : new Date() },
    );
    return this.findOneOrFail(id);
  }

  async addReport(report: NewReviewReport): Promise<void> {
    try {
      await this.reports.insert({
        ...report,
        reporterId: Number(report.reporterId),
      });
    } catch (error) {
      if (isUniqueViolation(error, 'review_report')) {
        throw new DuplicateReviewReportError();
      }

      throw error;
    }
  }

  async listReports(page: ReviewPage): Promise<ReviewReport[]> {
    const entities = await this.reports
      .createQueryBuilder('rr')
      .innerJoinAndSelect('rr.review', 'r')
      .leftJoinAndSelect('r.author', 'a')
      .leftJoinAndSelect('a.photo', 'p')
      .where('r."deletedAt" IS NULL')
      .orderBy('rr.createdAt', 'DESC')
      .addOrderBy('rr.id', 'DESC')
      .offset(page.offset)
      .limit(page.limit)
      .getMany();

    return entities.map((entity) => ReviewReportMapper.toDomain(entity));
  }

  /** Serializes the rating writers of one kitchen (READ COMMITTED would lose updates). */
  private async lockKitchen(
    manager: EntityManager,
    kitchenId: Kitchen['id'],
  ): Promise<void> {
    await manager.query(
      'SELECT "id" FROM "kitchen" WHERE "id" = $1 FOR UPDATE',
      [kitchenId],
    );
  }

  private async recompute(
    manager: EntityManager,
    kitchenId: Kitchen['id'],
  ): Promise<void> {
    const { ratingAvg, ratingCount } = ratingSummary(
      await ratingGroupsOf(manager, kitchenId),
    );
    await manager.update(
      KitchenEntity,
      { id: kitchenId },
      { ratingAvg, ratingCount },
    );
  }

  private async findOneWhere(
    where: FindOptionsWhere<ReviewEntity>,
  ): Promise<NullableType<Review>> {
    const entity = await this.reviews.findOne({ where, relations: RELATIONS });
    return entity ? ReviewMapper.toDomain(entity) : null;
  }

  private async findOneOrFail(id: Review['id']): Promise<Review> {
    const entity = await this.reviews.findOneOrFail({
      where: { id },
      relations: RELATIONS,
    });
    return ReviewMapper.toDomain(entity);
  }
}
```

`src/reviews/infrastructure/persistence/relational/relational-persistence.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewRepository } from '../review.repository';
import { ReviewReportEntity } from './entities/review-report.entity';
import { ReviewEntity } from './entities/review.entity';
import { ReviewRelationalRepository } from './repositories/review.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ReviewEntity, ReviewReportEntity])],
  providers: [
    {
      provide: ReviewRepository,
      useClass: ReviewRelationalRepository,
    },
  ],
  exports: [ReviewRepository],
})
export class RelationalReviewPersistenceModule {}
```

Run: `npx tsc --noEmit -p tsconfig.json` → hata yok.

- [ ] **Step 3: DTO'lar ve görünümler**

`src/reviews/dto/create-review.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReviewTag } from '../../trust/trust.enums';

const STARS = { minimum: 1, maximum: 5 };

export class CreateReviewDto {
  @ApiProperty({ ...STARS, description: 'Genel puan, zorunlu' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  taste?: number | null;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  portion?: number | null;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  packaging?: number | null;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  timing?: number | null;

  @ApiPropertyOptional({ enum: ReviewTag, isArray: true, maxItems: 3 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(ReviewTag, { each: true })
  tags?: ReviewTag[];

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 3,
    description: 'Yüklenmiş dosya id’leri',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds?: string[];
}
```

`src/reviews/dto/review-actions.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReviewReportReason } from '../../trust/trust.enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** PUT /kitchens/me/reviews/:id/reply — writes or replaces the answer. */
export class ReplyReviewDto {
  @ApiProperty({ maxLength: 300 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reply: string;
}

/** POST /kitchens/me/reviews/:id/report */
export class ReportReviewDto {
  @ApiProperty({ enum: ReviewReportReason })
  @IsEnum(ReviewReportReason)
  reason: ReviewReportReason;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

/** PATCH /admin/reviews/:id */
export class HideReviewDto {
  @ApiProperty()
  @IsBoolean()
  isHidden: boolean;
}
```

`src/reviews/dto/list-reviews.dto.ts` — dosyanın tamamı:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../orders/dto/list-orders.dto';
import { ReviewFilter } from '../../trust/trust.enums';

/** GET /kitchens/me/reviews */
export class ListCookReviewsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReviewFilter, default: ReviewFilter.all })
  @IsOptional()
  @IsEnum(ReviewFilter)
  filter: ReviewFilter = ReviewFilter.all;
}
```

`src/reviews/views.ts` — dosyanın tamamı:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { FileType } from '../files/domain/file';
import { ReviewReportReason, ReviewTag } from '../trust/trust.enums';

const STAR = { type: Number, minimum: 1, maximum: 5 };

/** The customer's own review: POST /orders/:id/review and `review` of an order. */
export class OrderReviewView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty(STAR)
  rating: number;

  @ApiProperty({ ...STAR, nullable: true })
  taste: number | null;

  @ApiProperty({ ...STAR, nullable: true })
  portion: number | null;

  @ApiProperty({ ...STAR, nullable: true })
  packaging: number | null;

  @ApiProperty({ ...STAR, nullable: true })
  timing: number | null;

  @ApiProperty({ enum: ReviewTag, isArray: true })
  tags: ReviewTag[];

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];

  @ApiProperty({ type: String, nullable: true, description: 'Aşçı yanıtı' })
  reply: string | null;

  @ApiProperty({ type: Date, nullable: true })
  repliedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

/** GET /discover/kitchens/:id/reviews */
export class ReviewView extends OrderReviewView {
  @ApiProperty({ type: String, nullable: true, description: 'Ad S.' })
  authorName: string | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  authorPhoto: FileType | null;
}

/** The cook's list (hidden ones labelled) and the admin's. */
export class KitchenReviewView extends ReviewView {
  @ApiProperty({ type: String })
  orderId: string;

  @ApiProperty({ type: String })
  kitchenId: string;

  @ApiProperty({ type: Boolean, description: 'Admin gizledi ("Gizlendi")' })
  isHidden: boolean;
}

export class RatingDistributionView {
  @ApiProperty({ type: Number })
  '1': number;

  @ApiProperty({ type: Number })
  '2': number;

  @ApiProperty({ type: Number })
  '3': number;

  @ApiProperty({ type: Number })
  '4': number;

  @ApiProperty({ type: Number })
  '5': number;
}

export class ReviewsSummaryView {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tek ondalık; değerlendirme yoksa null ("Yeni")',
  })
  ratingAvg: number | null;

  @ApiProperty({ type: Number })
  ratingCount: number;

  @ApiProperty({ type: () => RatingDistributionView })
  distribution: RatingDistributionView;

  @ApiProperty({
    enum: ReviewTag,
    isArray: true,
    description: 'En sık seçilen en çok 3 etiket',
  })
  topTags: ReviewTag[];
}

/** GET /discover/kitchens/:id/reviews — an infinite list plus the summary. */
export class KitchenReviewsPage {
  @ApiProperty({ type: () => ReviewView, isArray: true })
  data: ReviewView[];

  @ApiProperty({ type: Boolean })
  hasNextPage: boolean;

  @ApiProperty({ type: () => ReviewsSummaryView })
  summary: ReviewsSummaryView;
}

/** GET /admin/review-reports */
export class ReviewReportView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: ReviewReportReason })
  reason: ReviewReportReason;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: () => KitchenReviewView })
  review: KitchenReviewView;
}
```

- [ ] **Step 4: Presenter'lar — test**

`src/reviews/review.fixture.ts` — dosyanın tamamı:

```ts
import { FileType } from '../files/domain/file';
import { ReviewTag } from '../trust/trust.enums';
import { Review } from './domain/review';

/** Unit-test fixture for the review specs. */
export const aReview = (overrides: Partial<Review> = {}): Review =>
  Object.assign(new Review(), {
    id: 'r1',
    orderId: 'o1',
    kitchenId: 'k1',
    authorId: 9,
    rating: 5,
    taste: 5,
    portion: null,
    packaging: null,
    timing: null,
    tags: [ReviewTag.homemade],
    comment: 'Annemin mantısı gibi',
    photos: [Object.assign(new FileType(), { id: 'f1', path: '/f1.png' })],
    reply: null,
    repliedAt: null,
    isHidden: false,
    author: { firstName: 'Deniz', lastName: 'İnce', photo: null },
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    deletedAt: null,
    ...overrides,
  });
```

`src/reviews/presenters.spec.ts` — dosyanın tamamı:

```ts
import { ReviewReportReason, ReviewTag } from '../trust/trust.enums';
import {
  kitchenReviewView,
  orderReviewView,
  reviewReportView,
  reviewView,
  reviewsSummary,
} from './presenters';
import { aReview } from './review.fixture';

describe('review presenters', () => {
  it('should name the author briefly in the public list', () => {
    const view = reviewView(aReview());

    expect(view).toMatchObject({
      id: 'r1',
      rating: 5,
      authorName: 'Deniz İ.',
      authorPhoto: null,
      tags: ['homemade'],
    });
    expect(view).not.toHaveProperty('authorId');
    expect(view).not.toHaveProperty('author');
    expect(view).not.toHaveProperty('isHidden');
  });

  it('should leave the author out of the customer’s own review', () => {
    const view = orderReviewView(aReview({ reply: 'Afiyet olsun' }));

    expect(view).toMatchObject({
      reply: 'Afiyet olsun',
      comment: 'Annemin mantısı gibi',
    });
    expect(view).not.toHaveProperty('authorName');
  });

  it('should label hidden reviews for the cook', () => {
    expect(kitchenReviewView(aReview({ isHidden: true }))).toMatchObject({
      orderId: 'o1',
      kitchenId: 'k1',
      isHidden: true,
      authorName: 'Deniz İ.',
    });
  });

  it('should carry the reported review', () => {
    expect(
      reviewReportView({
        id: 'rr1',
        reviewId: 'r1',
        reporterId: 7,
        reason: ReviewReportReason.falseClaim,
        note: null,
        review: aReview(),
        createdAt: new Date('2026-10-13T08:00:00Z'),
      }),
    ).toMatchObject({
      id: 'rr1',
      reason: 'false_claim',
      review: { id: 'r1', isHidden: false },
    });
  });

  it('should summarize the counted reviews and the top tags', () => {
    expect(
      reviewsSummary(
        [
          { rating: 5, isHidden: false, isDeleted: false, count: 3 },
          { rating: 4, isHidden: false, isDeleted: false, count: 1 },
          { rating: 1, isHidden: true, isDeleted: false, count: 2 },
        ],
        [
          { tag: ReviewTag.onTime, count: 1 },
          { tag: ReviewTag.homemade, count: 4 },
        ],
      ),
    ).toEqual({
      ratingAvg: 4.8,
      ratingCount: 4,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 3 },
      topTags: ['homemade', 'on_time'],
    });
  });
});
```

Run: `npx jest src/reviews/presenters.spec.ts` → FAIL (`Cannot find module './presenters'`).

- [ ] **Step 5: Presenter'lar — kod**

`src/reviews/presenters.ts` — dosyanın tamamı:

```ts
import { shortName } from '../orders/presenters';
import { RatingGroup, ratingSummary, topTags } from '../trust/trust-rules';
import { TagCount } from './infrastructure/persistence/review.repository';
import { Review } from './domain/review';
import { ReviewReport } from './domain/review-report';
import {
  KitchenReviewView,
  OrderReviewView,
  ReviewReportView,
  ReviewView,
  ReviewsSummaryView,
} from './views';

const ownFields = (review: Review) => ({
  id: review.id,
  rating: review.rating,
  taste: review.taste,
  portion: review.portion,
  packaging: review.packaging,
  timing: review.timing,
  tags: review.tags,
  comment: review.comment,
  photos: review.photos,
  reply: review.reply,
  repliedAt: review.repliedAt,
  createdAt: review.createdAt,
});

export const orderReviewView = (review: Review): OrderReviewView =>
  Object.assign(new OrderReviewView(), ownFields(review));

/** The author as "Ad S." with their photo — never a full name. */
export const reviewView = (review: Review): ReviewView =>
  Object.assign(new ReviewView(), ownFields(review), {
    authorName: shortName(review.author),
    authorPhoto: review.author.photo,
  });

export const kitchenReviewView = (review: Review): KitchenReviewView =>
  Object.assign(new KitchenReviewView(), reviewView(review), {
    orderId: review.orderId,
    kitchenId: review.kitchenId,
    isHidden: review.isHidden,
  });

export const reviewReportView = (report: ReviewReport): ReviewReportView =>
  Object.assign(new ReviewReportView(), {
    id: report.id,
    reason: report.reason,
    note: report.note,
    createdAt: report.createdAt,
    review: kitchenReviewView(report.review),
  });

export function reviewsSummary(
  groups: RatingGroup[],
  tags: TagCount[],
): ReviewsSummaryView {
  const { ratingAvg, ratingCount, distribution } = ratingSummary(groups);
  return Object.assign(new ReviewsSummaryView(), {
    ratingAvg,
    ratingCount,
    distribution,
    topTags: topTags(tags),
  });
}
```

Run: `npx jest src/reviews/presenters.spec.ts` → PASS (5 test).

- [ ] **Step 6: Servis — test**

`src/reviews/reviews.service.spec.ts` — dosyanın tamamı:

```ts
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { anOrder } from '../orders/order.fixture';
import { OrderStatus } from '../orders/order.enums';
import {
  ReviewFilter,
  ReviewReportReason,
  ReviewTag,
} from '../trust/trust.enums';
import {
  DuplicateReviewError,
  DuplicateReviewReportError,
  ReviewRepository,
} from './infrastructure/persistence/review.repository';
import { aReview } from './review.fixture';
import { ReviewsService } from './reviews.service';

const NOW = new Date('2026-10-14T10:00:00Z');
const completed = anOrder({
  status: OrderStatus.completed,
  completedAt: new Date('2026-10-12T10:00:00Z'),
});

const conflictKey = (error: unknown) =>
  ((error as ConflictException).getResponse() as { error: string }).error;

const build = (order: Order | null = completed) => {
  const reviews = {
    create: jest
      .fn()
      .mockImplementation((data) => Promise.resolve(aReview(data))),
    findForAuthor: jest.fn().mockResolvedValue(aReview()),
    findForKitchen: jest.fn().mockResolvedValue(aReview()),
    findById: jest.fn().mockResolvedValue(aReview()),
    findByOrderIds: jest.fn().mockResolvedValue([]),
    listVisible: jest.fn().mockResolvedValue([aReview()]),
    listForKitchen: jest.fn().mockResolvedValue([aReview()]),
    ratingGroups: jest
      .fn()
      .mockResolvedValue([
        { rating: 5, isHidden: false, isDeleted: false, count: 1 },
      ]),
    tagCounts: jest
      .fn()
      .mockResolvedValue([{ tag: ReviewTag.homemade, count: 1 }]),
    softDelete: jest.fn().mockResolvedValue(undefined),
    setHidden: jest
      .fn()
      .mockImplementation((id, isHidden) =>
        Promise.resolve(aReview({ id, isHidden })),
      ),
    setReply: jest
      .fn()
      .mockImplementation((id, reply) =>
        Promise.resolve(aReview({ id, reply })),
      ),
    addReport: jest.fn().mockResolvedValue(undefined),
    listReports: jest.fn().mockResolvedValue([]),
  };
  const orders = { findForCustomer: jest.fn().mockResolvedValue(order) };
  const kitchens = {
    findById: jest.fn().mockResolvedValue({ id: 'k1' }),
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const files = {
    findByIds: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids
          .filter((id) => id !== 'missing')
          .map((id) => Object.assign(new FileType(), { id, path: `/${id}` })),
      ),
    ),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'trust.reviewWindowDays': 7 })[key],
  };

  const service = new ReviewsService(
    reviews as unknown as ReviewRepository,
    orders as unknown as OrderRepository,
    kitchens as unknown as KitchensService,
    files as unknown as FilesService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, reviews, orders, kitchens };
};

describe('ReviewsService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('should store the review against the order’s kitchen', async () => {
      const { service, reviews } = build();

      const view = await service.create(9, 'o1', {
        rating: 4,
        taste: 5,
        tags: [ReviewTag.arrivedHot],
        comment: '  Sıcacık geldi  ',
        photoIds: ['f9'],
      });

      expect(reviews.create).toHaveBeenCalledWith({
        orderId: 'o1',
        kitchenId: 'k1',
        authorId: 9,
        rating: 4,
        taste: 5,
        portion: null,
        packaging: null,
        timing: null,
        tags: [ReviewTag.arrivedHot],
        comment: 'Sıcacık geldi',
        photos: [expect.objectContaining({ id: 'f9' })],
      });
      expect(view).toMatchObject({ rating: 4, comment: 'Sıcacık geldi' });
      expect(view).not.toHaveProperty('authorName');
    });

    it('should 404 someone else’s order', async () => {
      const { service } = build(null);

      await expect(
        service.create(9, 'o1', { rating: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should 409 reviewExists when the order has a review, deleted or not', async () => {
      const { service, reviews } = build();
      reviews.findByOrderIds.mockResolvedValue([
        aReview({ deletedAt: new Date() }),
      ]);

      const error = await service
        .create(9, 'o1', { rating: 5 })
        .catch((e) => e);

      expect(conflictKey(error)).toBe('reviewExists');
      expect(reviews.create).not.toHaveBeenCalled();
    });

    it('should 409 reviewNotAllowed before completion and after 7 days', async () => {
      for (const order of [
        anOrder({ status: OrderStatus.onTheWay }),
        anOrder({
          status: OrderStatus.completed,
          completedAt: new Date('2026-10-07T09:59:00Z'),
        }),
      ]) {
        const { service } = build(order);

        const error = await service
          .create(9, 'o1', { rating: 5 })
          .catch((e) => e);

        expect(conflictKey(error)).toBe('reviewNotAllowed');
      }
    });

    it('should turn a concurrent duplicate into reviewExists', async () => {
      const { service, reviews } = build();
      reviews.create.mockRejectedValue(new DuplicateReviewError());

      const error = await service
        .create(9, 'o1', { rating: 5 })
        .catch((e) => e);

      expect(conflictKey(error)).toBe('reviewExists');
    });

    it('should 422 an unknown photo', async () => {
      const { service } = build();

      await expect(
        service.create(9, 'o1', { rating: 5, photoIds: ['missing'] }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  it('should let only the author delete a review', async () => {
    const { service, reviews } = build();

    await service.remove(9, 'r1');
    expect(reviews.findForAuthor).toHaveBeenCalledWith(9, 'r1');
    expect(reviews.softDelete).toHaveBeenCalledWith('r1');

    reviews.findForAuthor.mockResolvedValue(null);
    await expect(service.remove(10, 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should list a kitchen’s visible reviews with the summary', async () => {
    const { service, reviews } = build();

    const page = await service.kitchenReviews('k1', { page: 2, limit: 1 });

    expect(reviews.listVisible).toHaveBeenCalledWith('k1', {
      offset: 1,
      limit: 1,
    });
    expect(page).toMatchObject({
      data: [{ id: 'r1', authorName: 'Deniz İ.' }],
      hasNextPage: true,
      summary: { ratingAvg: 5, ratingCount: 1, topTags: ['homemade'] },
    });
  });

  it('should 404 the reviews of a kitchen that is gone', async () => {
    const { service, kitchens } = build();
    kitchens.findById.mockResolvedValue(null);

    await expect(
      service.kitchenReviews('k1', { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should list the cook’s reviews with the filter', async () => {
    const { service, reviews } = build();

    await service.listMine(7, {
      filter: ReviewFilter.unreplied,
      page: 1,
      limit: 20,
    });

    expect(reviews.listForKitchen).toHaveBeenCalledWith(
      'k1',
      ReviewFilter.unreplied,
      { offset: 0, limit: 20 },
    );
  });

  it('should reply only to reviews of the cook’s kitchen', async () => {
    const { service, reviews } = build();

    await expect(service.reply(7, 'r1', 'Teşekkürler')).resolves.toMatchObject({
      reply: 'Teşekkürler',
    });
    await service.removeReply(7, 'r1');
    expect(reviews.setReply).toHaveBeenLastCalledWith('r1', null);

    reviews.findForKitchen.mockResolvedValue(null);
    await expect(service.reply(7, 'r2', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should report once, then 409 reviewAlreadyReported', async () => {
    const { service, reviews } = build();

    await service.report(7, 'r1', {
      reason: ReviewReportReason.offensive,
      note: '  ',
    });
    expect(reviews.addReport).toHaveBeenCalledWith({
      reviewId: 'r1',
      reporterId: 7,
      reason: ReviewReportReason.offensive,
      note: null,
    });

    reviews.addReport.mockRejectedValue(new DuplicateReviewReportError());
    const error = await service
      .report(7, 'r1', { reason: ReviewReportReason.other })
      .catch((e) => e);
    expect(conflictKey(error)).toBe('reviewAlreadyReported');
  });

  it('should hide a live review and 404 a missing one', async () => {
    const { service, reviews } = build();

    await expect(service.setHidden('r1', true)).resolves.toMatchObject({
      isHidden: true,
    });

    reviews.findById.mockResolvedValue(null);
    await expect(service.setHidden('r2', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Run: `npx jest src/reviews/reviews.service.spec.ts` → FAIL (modül yok).

- [ ] **Step 7: Servis — kod**

İkinci değerlendirme (silinmiş olsa bile) **409 `reviewExists`**, diğer uygunsuzluklar **409 `reviewNotAllowed`**; eşzamanlı ikinci istek `orderId` unique ihlaliyle `DuplicateReviewError` olur ve yine `reviewExists`'e çevrilir.

`src/reviews/reviews.service.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FilesService } from '../files/files.service';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { PageQueryDto } from '../orders/dto/list-orders.dto';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import {
  reviewAlreadyReported,
  reviewExists,
  reviewNotAllowed,
} from '../trust/trust-errors';
import { photosByIds } from '../trust/trust-photos';
import { canReview } from '../trust/trust-rules';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { Review } from './domain/review';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListCookReviewsQueryDto } from './dto/list-reviews.dto';
import { ReportReviewDto } from './dto/review-actions.dto';
import {
  DuplicateReviewError,
  DuplicateReviewReportError,
  ReviewPage,
  ReviewRepository,
} from './infrastructure/persistence/review.repository';
import {
  kitchenReviewView,
  orderReviewView,
  reviewReportView,
  reviewView,
  reviewsSummary,
} from './presenters';
import {
  KitchenReviewView,
  KitchenReviewsPage,
  OrderReviewView,
  ReviewReportView,
} from './views';

const textOrNull = (text: string | null | undefined) => text?.trim() || null;

const pageOf = (query: PageQueryDto): ReviewPage => ({
  offset: (query.page - 1) * query.limit,
  limit: query.limit,
});

/** Reviews from the customer, the cook and the admin side. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly orderRepository: OrderRepository,
    private readonly kitchensService: KitchensService,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** 409 reviewExists for a second review, 409 reviewNotAllowed otherwise. */
  async create(
    customerId: User['id'],
    orderId: Order['id'],
    dto: CreateReviewDto,
  ): Promise<OrderReviewView> {
    const order = await orNotFound(
      this.orderRepository.findForCustomer(customerId, orderId),
    );
    const [existing] = await this.reviewRepository.findByOrderIds([order.id]);

    if (existing) {
      throw reviewExists();
    }

    const windowDays = this.configService.getOrThrow('trust.reviewWindowDays', {
      infer: true,
    });

    if (!canReview(order, false, new Date(), windowDays)) {
      throw reviewNotAllowed();
    }

    const photos = await photosByIds(this.filesService, dto.photoIds ?? []);

    try {
      return orderReviewView(
        await this.reviewRepository.create({
          orderId: order.id,
          kitchenId: order.kitchenId,
          authorId: customerId,
          rating: dto.rating,
          taste: dto.taste ?? null,
          portion: dto.portion ?? null,
          packaging: dto.packaging ?? null,
          timing: dto.timing ?? null,
          tags: dto.tags ?? [],
          comment: textOrNull(dto.comment),
          photos,
        }),
      );
    } catch (error) {
      if (error instanceof DuplicateReviewError) {
        throw reviewExists();
      }

      throw error;
    }
  }

  /** Only the author; the kitchen's rating is recomputed. */
  async remove(authorId: User['id'], id: Review['id']): Promise<void> {
    const review = await orNotFound(
      this.reviewRepository.findForAuthor(authorId, id),
    );
    await this.reviewRepository.softDelete(review.id);
  }

  /** Visible reviews of a live kitchen, newest first, with the summary. */
  async kitchenReviews(
    kitchenId: Kitchen['id'],
    query: PageQueryDto,
  ): Promise<KitchenReviewsPage> {
    const kitchen = await orNotFound(this.kitchensService.findById(kitchenId));
    const [reviews, groups, tags] = await Promise.all([
      this.reviewRepository.listVisible(kitchen.id, pageOf(query)),
      this.reviewRepository.ratingGroups(kitchen.id),
      this.reviewRepository.tagCounts(kitchen.id),
    ]);

    return {
      ...infinityPagination(reviews.map(reviewView), {
        page: query.page,
        limit: query.limit,
      }),
      summary: reviewsSummary(groups, tags),
    };
  }

  async listMine(
    ownerId: User['id'],
    query: ListCookReviewsQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenReviewView>> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    const reviews = await this.reviewRepository.listForKitchen(
      kitchen.id,
      query.filter,
      pageOf(query),
    );

    return infinityPagination(reviews.map(kitchenReviewView), {
      page: query.page,
      limit: query.limit,
    });
  }

  /** Writes or replaces the cook's answer. */
  async reply(
    ownerId: User['id'],
    id: Review['id'],
    reply: string,
  ): Promise<KitchenReviewView> {
    const review = await this.mine(ownerId, id);
    return kitchenReviewView(
      await this.reviewRepository.setReply(review.id, reply),
    );
  }

  async removeReply(ownerId: User['id'], id: Review['id']): Promise<void> {
    const review = await this.mine(ownerId, id);
    await this.reviewRepository.setReply(review.id, null);
  }

  /** The review stays visible; an admin decides. Twice → 409 reviewAlreadyReported. */
  async report(
    ownerId: User['id'],
    id: Review['id'],
    dto: ReportReviewDto,
  ): Promise<void> {
    const review = await this.mine(ownerId, id);

    try {
      await this.reviewRepository.addReport({
        reviewId: review.id,
        reporterId: ownerId,
        reason: dto.reason,
        note: textOrNull(dto.note),
      });
    } catch (error) {
      if (error instanceof DuplicateReviewReportError) {
        throw reviewAlreadyReported();
      }

      throw error;
    }
  }

  async listReports(
    query: PageQueryDto,
  ): Promise<InfinityPaginationResponseDto<ReviewReportView>> {
    const reports = await this.reviewRepository.listReports(pageOf(query));
    return infinityPagination(reports.map(reviewReportView), {
      page: query.page,
      limit: query.limit,
    });
  }

  /** Admin: a hidden review leaves the public list and the rating. */
  async setHidden(
    id: Review['id'],
    isHidden: boolean,
  ): Promise<KitchenReviewView> {
    const review = await orNotFound(this.reviewRepository.findById(id));
    return kitchenReviewView(
      await this.reviewRepository.setHidden(review.id, isHidden),
    );
  }

  /** A review of the cook's own kitchen (404 without a kitchen or for another's). */
  private async mine(ownerId: User['id'], id: Review['id']): Promise<Review> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return orNotFound(this.reviewRepository.findForKitchen(kitchen.id, id));
  }
}
```

Run: `npx jest src/reviews` → PASS (21 test).

- [ ] **Step 8: Controller'lar ve modül**

Müşteri uçları farklı köklerde olduğu için (`orders`, `reviews`, `discover`) controller'ın yolu boştur. Admin uçları sınıf seviyesinde `@Roles(RoleEnum.admin)` + `RolesGuard` (`users.controller.ts` deseni).

`src/reviews/reviews.controller.ts` — dosyanın tamamı:

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
  Post,
  Query,
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
import { PageQueryDto } from '../orders/dto/list-orders.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';
import { KitchenReviewsPage, OrderReviewView } from './views';

/** The customer's side: review an order, delete it, read a kitchen's reviews. */
@ApiTags('Reviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  version: '1',
})
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('orders/:id/review')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: OrderReviewView })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<OrderReviewView> {
    return this.reviewsService.create(request.user.id, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.reviewsService.remove(request.user.id, id);
  }

  @Get('discover/kitchens/:id/reviews')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenReviewsPage })
  kitchenReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<KitchenReviewsPage> {
    return this.reviewsService.kitchenReviews(id, query);
  }
}
```

`src/reviews/cook-reviews.controller.ts` — dosyanın tamamı:

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
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
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
import { ListCookReviewsQueryDto } from './dto/list-reviews.dto';
import { ReplyReviewDto, ReportReviewDto } from './dto/review-actions.dto';
import { ReviewsService } from './reviews.service';
import { KitchenReviewView } from './views';

/** Reviews of the signed-in cook's kitchen; no kitchen → 404. */
@ApiTags('Kitchen reviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/reviews',
  version: '1',
})
export class CookReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(KitchenReviewView) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListCookReviewsQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenReviewView>> {
    return this.reviewsService.listMine(request.user.id, query);
  }

  @Put(':id/reply')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenReviewView })
  reply(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyReviewDto,
  ): Promise<KitchenReviewView> {
    return this.reviewsService.reply(request.user.id, id, dto.reply);
  }

  @Delete(':id/reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  removeReply(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.reviewsService.removeReply(request.user.id, id);
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  report(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportReviewDto,
  ): Promise<void> {
    return this.reviewsService.report(request.user.id, id, dto);
  }
}
```

`src/reviews/admin-reviews.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PageQueryDto } from '../orders/dto/list-orders.dto';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import { HideReviewDto } from './dto/review-actions.dto';
import { ReviewsService } from './reviews.service';
import { KitchenReviewView, ReviewReportView } from './views';

/** Swagger-only moderation (no admin panel): reported reviews, hide/show. */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({
  path: 'admin',
  version: '1',
})
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('review-reports')
  @ApiOkResponse({ type: InfinityPaginationResponse(ReviewReportView) })
  reports(
    @Query() query: PageQueryDto,
  ): Promise<InfinityPaginationResponseDto<ReviewReportView>> {
    return this.reviewsService.listReports(query);
  }

  @Patch('reviews/:id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenReviewView })
  setHidden(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideReviewDto,
  ): Promise<KitchenReviewView> {
    return this.reviewsService.setHidden(id, dto.isHidden);
  }
}
```

`src/reviews/reviews.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { CookReviewsController } from './cook-reviews.controller';
import { RelationalReviewPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalReviewPersistenceModule,
    OrdersModule,
    KitchensModule,
    FilesModule,
  ],
  controllers: [
    ReviewsController,
    CookReviewsController,
    AdminReviewsController,
  ],
  providers: [ReviewsService],
  exports: [ReviewsService, RelationalReviewPersistenceModule],
})
export class ReviewsModule {}
```

`src/app.module.ts` — şu bloğu:

```ts

import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    PaymentsModule,
    OrdersModule,
    DiscoveryModule,
```

şununla değiştir:

```ts

import { PaymentsModule } from './payments/payments.module';

import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ReviewsModule,
    PaymentsModule,
    OrdersModule,
    DiscoveryModule,
```

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: temiz. Dev API yeniden başlar; logda `Mapped {/api/orders/:id/review, POST}` … `Mapped {/api/admin/reviews/:id, PATCH}` dokuz rota görünür, `ERROR` yok.

- [ ] **Step 9: e2e — yardımcılar**

Sipariş tamamlama akışı her güven testi dosyasında gerekiyor; ürün fotoğrafı yükleme de `uploadPhoto`'ya taşınır.

`test/utils/orders.ts` — dosyanın başındaki şu bloğu:

```ts
import request from 'supertest';
import { DataSource } from 'typeorm';
import { APP_URL } from './constants';

export type Spot = { latitude: number; longitude: number };

```

şununla değiştir:

```ts
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from './constants';

export type Spot = { latitude: number; longitude: number };

```

`test/utils/orders.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
  return body.data.find((c: { slug: string }) => c.slug === slug).id;
}

/** Uploads a 1×1 PNG and returns the file id. */
export async function uploadPhoto(token: string): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/files/upload')
    .auth(token, { type: 'bearer' })
    .attach('file', PNG, 'photo.png')
    .expect(201);
  return body.data.file.id;
}

export async function addProduct(
  token: string,
  product: Record<string, unknown>,
): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/kitchens/me/products')
    .auth(token, { type: 'bearer' })
    .send({
      allergens: [],
      dietTags: [],
      photoIds: [await uploadPhoto(token)],
      ...product,
    })
    .expect(201);
  return body.data.id;
}

export async function adminLogin(): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(200);
  return body.data.token;
}

export type Cart = {
  kitchenId: string;
  fulfillment: 'pickup' | 'delivery';
  addressId?: string;
  items: { productId: string; quantity: number }[];
};

export type PlacedOrder = {
  id: string;
  pickupCode: string | null;
  totalKurus: number;
};

/** Quotes the cart and places it at the quoted total. */
export async function placeOrder(
  token: string,
  cart: Cart,
): Promise<PlacedOrder> {
  const quote = await request(APP_URL)
    .post('/api/v1/orders/quote')
    .auth(token, { type: 'bearer' })
    .send(cart)
    .expect(200);
  const { body } = await request(APP_URL)
    .post('/api/v1/orders')
    .auth(token, { type: 'bearer' })
    .set('Idempotency-Key', randomUUID())
    .send({
      ...cart,
      acceptedTerms: true,
      expectedTotalKurus: quote.body.data.totalKurus,
    })
    .expect(201);
  return body.data;
}

export async function cookStep(
  token: string,
  orderId: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  await request(APP_URL)
    .post(`/api/v1/kitchens/me/orders/${orderId}/${action}`)
    .auth(token, { type: 'bearer' })
    .send(body)
    .expect(200);
}

/** Places the cart and walks it to `completed` (pickup with the code, delivery via dispatch). */
export async function completeOrder(
  cook: string,
  customer: string,
  cart: Cart,
): Promise<string> {
  const order = await placeOrder(customer, cart);

  for (const action of ['accept', 'start', 'ready']) {
    await cookStep(cook, order.id, action);
  }

  if (cart.fulfillment === 'delivery') {
    await cookStep(cook, order.id, 'dispatch');
    await cookStep(cook, order.id, 'complete');
  } else {
    await cookStep(cook, order.id, 'complete', {
      pickupCode: order.pickupCode,
    });
  }

  return order.id;
}

/** Direct SQL for what the API cannot do on demand (moving the clock). */
```

- [ ] **Step 10: e2e — değerlendirme akışı**

Puan kontrolleri `kitchen` satırını doğrudan okur: oluşturma, gizleme ve silmenin puanı **aynı yazımda** güncellediğini kanıtlar.

`test/user/reviews.e2e-spec.ts` — dosyanın tamamı:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Cart,
  addProduct,
  adminLogin,
  categoryId,
  completeOrder,
  openKitchen,
  phoneLogin,
  placeOrder,
  randomSpot,
  setName,
  testDatabase,
  uniquePhone,
  uploadPhoto,
} from '../utils/orders';

describe('Reviews', () => {
  const app = APP_URL;
  const db = testDatabase();
  let cook: string;
  let otherCook: string;
  let customer: string;
  let stranger: string;
  let admin: string;
  let kitchenId: string;
  let cart: Cart;
  let orderA: string;
  let orderB: string;
  let reviewA: string;
  let reviewB: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const put = (path: string, token: string) =>
    request(app).put(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token: string) =>
    request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const del = (path: string, token: string) =>
    request(app).delete(`/api/v1${path}`).auth(token, { type: 'bearer' });

  /** What the review transactions wrote on the kitchen row. */
  const storedRating = async () => {
    const [row] = await db.query(
      'SELECT "ratingAvg", "ratingCount" FROM "kitchen" WHERE "id" = $1',
      [kitchenId],
    );
    return row as { ratingAvg: number | null; ratingCount: number };
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90563'));
    otherCook = await phoneLogin(uniquePhone('+90564'));
    customer = await phoneLogin(uniquePhone('+90565'));
    stranger = await phoneLogin(uniquePhone('+90566'));
    admin = await adminLogin();
    await setName(cook, 'Ayşe', 'Yılmaz');
    await setName(customer, 'Deniz', 'Arslan');

    kitchenId = await openKitchen(cook, randomSpot());
    await openKitchen(otherCook, randomSpot());
    const mantiId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    cart = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId: mantiId, quantity: 1 }],
    };

    orderA = await completeOrder(cook, customer, cart);
    orderB = await completeOrder(cook, customer, cart);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('writing', () => {
    it('should 409 reviewNotAllowed before the order is completed', async () => {
      const pending = await placeOrder(customer, cart);

      await post(`/orders/${pending.id}/review`, customer)
        .send({ rating: 5 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewNotAllowed');
        });

      await post(`/orders/${pending.id}/cancel`, customer).expect(200);
    });

    it('should 422 bad stars, too many tags and unknown photos', () =>
      post(`/orders/${orderA}/review`, customer)
        .send({
          rating: 6,
          taste: 0,
          tags: ['homemade', 'on_time', 'arrived_hot', 'friendly_cook'],
          comment: 'x'.repeat(501),
          photoIds: ['not-a-uuid'],
        })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors.map((e: { field: string }) => e.field)).toEqual(
            expect.arrayContaining([
              'rating',
              'taste',
              'tags',
              'comment',
              'photoIds',
            ]),
          );
        }));

    it('should 404 someone else’s order', () =>
      post(`/orders/${orderA}/review`, stranger)
        .send({ rating: 5 })
        .expect(404));

    it('should review a completed order and rate the kitchen in the same write', async () => {
      const photoId = await uploadPhoto(customer);

      const { body } = await post(`/orders/${orderA}/review`, customer)
        .send({
          rating: 5,
          taste: 5,
          tags: ['homemade', 'arrived_hot'],
          comment: '  Annemin mantısı gibi  ',
          photoIds: [photoId],
        })
        .expect(201);
      reviewA = body.data.id;

      expect(body.data).toMatchObject({
        rating: 5,
        taste: 5,
        portion: null,
        tags: ['homemade', 'arrived_hot'],
        comment: 'Annemin mantısı gibi',
        photos: [{ id: photoId }],
        reply: null,
      });
      expect(await storedRating()).toEqual({ ratingAvg: 5, ratingCount: 1 });
    });

    it('should 409 reviewExists the second time', () =>
      post(`/orders/${orderA}/review`, customer)
        .send({ rating: 1 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewExists');
        }));

    it('should average two reviews to one decimal', async () => {
      const { body } = await post(`/orders/${orderB}/review`, customer)
        .send({ rating: 4, tags: ['homemade'] })
        .expect(201);
      reviewB = body.data.id;

      expect(await storedRating()).toEqual({ ratingAvg: 4.5, ratingCount: 2 });
    });

    it('should close 7 days after completion', async () => {
      const late = await completeOrder(cook, customer, cart);
      await db.query(
        `UPDATE "order" SET "completedAt" = now() - interval '7 days 1 minute' WHERE "id" = $1`,
        [late],
      );

      await post(`/orders/${late}/review`, customer)
        .send({ rating: 5 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewNotAllowed');
        });
    });
  });

  describe('reading', () => {
    it('should list visible reviews newest first with the summary', () =>
      get(`/discover/kitchens/${kitchenId}/reviews`, stranger)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
            reviewB,
            reviewA,
          ]);
          expect(body.data.data[1]).toMatchObject({
            authorName: 'Deniz A.',
            comment: 'Annemin mantısı gibi',
          });
          expect(body.data.data[1]).not.toHaveProperty('authorId');
          expect(body.data.hasNextPage).toBe(false);
          expect(body.data.summary).toEqual({
            ratingAvg: 4.5,
            ratingCount: 2,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
            topTags: ['homemade', 'arrived_hot'],
          });
        }));

    it('should page the list', () =>
      get(`/discover/kitchens/${kitchenId}/reviews?page=1&limit=1`, stranger)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data).toHaveLength(1);
          expect(body.data.hasNextPage).toBe(true);
        }));
  });

  describe('the cook', () => {
    it('should list unreplied reviews, reply, edit and delete the reply', async () => {
      await get('/kitchens/me/reviews?filter=unreplied', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data).toHaveLength(2);
          expect(body.data.data[0]).toMatchObject({
            id: reviewB,
            orderId: orderB,
            isHidden: false,
          });
        });

      await put(`/kitchens/me/reviews/${reviewA}/reply`, cook)
        .send({ reply: '  ' })
        .expect(422);

      await put(`/kitchens/me/reviews/${reviewA}/reply`, cook)
        .send({ reply: 'Afiyet olsun!' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({ reply: 'Afiyet olsun!' });
          expect(body.data.repliedAt).toEqual(expect.any(String));
        });

      await put(`/kitchens/me/reviews/${reviewA}/reply`, cook)
        .send({ reply: 'Afiyet olsun, yine bekleriz!' })
        .expect(200);

      await get(`/discover/kitchens/${kitchenId}/reviews`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data[1].reply).toBe('Afiyet olsun, yine bekleriz!');
        });

      await get('/kitchens/me/reviews?filter=unreplied', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
            reviewB,
          ]);
        });

      await del(`/kitchens/me/reviews/${reviewB}/reply`, cook).expect(204);
    });

    it('should keep another cook out', async () => {
      await put(`/kitchens/me/reviews/${reviewA}/reply`, otherCook)
        .send({ reply: 'Hey' })
        .expect(404);
      await post(`/kitchens/me/reviews/${reviewA}/report`, otherCook)
        .send({ reason: 'other' })
        .expect(404);
      await get('/kitchens/me/reviews', customer).expect(404);
    });

    it('should report a review once', async () => {
      await post(`/kitchens/me/reviews/${reviewB}/report`, cook)
        .send({ reason: 'nonsense' })
        .expect(422);

      await post(`/kitchens/me/reviews/${reviewB}/report`, cook)
        .send({ reason: 'false_claim', note: 'Porsiyon tamdı' })
        .expect(204);

      await post(`/kitchens/me/reviews/${reviewB}/report`, cook)
        .send({ reason: 'other' })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewAlreadyReported');
        });
    });
  });

  describe('the admin', () => {
    it('should keep moderation to admins', async () => {
      await get('/admin/review-reports', cook).expect(403);
      await patch(`/admin/reviews/${reviewB}`, cook)
        .send({ isHidden: true })
        .expect(403);
    });

    it('should list the report', () =>
      get('/admin/review-reports?limit=50', admin)
        .expect(200)
        .expect(({ body }) => {
          const report = body.data.data.find(
            (r: { review: { id: string } }) => r.review.id === reviewB,
          );
          expect(report).toMatchObject({
            reason: 'false_claim',
            note: 'Porsiyon tamdı',
            review: { id: reviewB, kitchenId, isHidden: false },
          });
        }));

    it('should hide a review from the list and the rating, then show it again', async () => {
      await patch(`/admin/reviews/${reviewB}`, admin)
        .send({ isHidden: true })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.isHidden).toBe(true);
        });

      expect(await storedRating()).toEqual({ ratingAvg: 5, ratingCount: 1 });

      await get(`/discover/kitchens/${kitchenId}/reviews`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
            reviewA,
          ]);
          expect(body.data.summary.ratingCount).toBe(1);
        });

      await get('/kitchens/me/reviews', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data[0]).toMatchObject({
            id: reviewB,
            isHidden: true,
          });
        });

      await patch(`/admin/reviews/${reviewB}`, admin)
        .send({ isHidden: false })
        .expect(200);

      expect(await storedRating()).toEqual({ ratingAvg: 4.5, ratingCount: 2 });
    });
  });

  describe('deleting', () => {
    it('should let only the author delete, recompute and never allow a second review', async () => {
      await del(`/reviews/${reviewA}`, stranger).expect(404);
      await del(`/reviews/${reviewA}`, customer).expect(204);

      expect(await storedRating()).toEqual({ ratingAvg: 4, ratingCount: 1 });

      await post(`/orders/${orderA}/review`, customer)
        .send({ rating: 5 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewExists');
        });

      await del(`/reviews/${reviewA}`, customer).expect(404);
    });

    it('should 404 the reviews of an unknown kitchen', () =>
      get(
        '/discover/kitchens/00000000-0000-4000-8000-000000000000/reviews',
        customer,
      ).expect(404));
  });
});
```

Run: `npm run test:e2e -- --runInBand test/user/reviews.e2e-spec.ts`
Expected: PASS (17 test). Admin girişi seed'deki `admin@example.com` / `secret` ile yapılır.

- [ ] **Step 11: Tüm paket ve commit**

Run: `npm run lint && npm test && npm run test:e2e -- --runInBand` → temiz, PASS.

```bash
git add src/reviews src/orders/orders.module.ts src/orders/dto/list-orders.dto.ts src/app.module.ts test/utils/orders.ts test/user/reviews.e2e-spec.ts
git commit -m "feat(reviews): review completed orders, reply, report and hide as admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Favoriler ve keşifte puan/kalp

**Files:**
- Modify: `src/discovery/views.ts`, `src/discovery/presenters.ts`, `src/discovery/presenters.spec.ts`, `src/discovery/discovery.service.ts`, `src/discovery/discovery.module.ts`, `src/app.module.ts`
- Create: `src/favorites/infrastructure/persistence/favorite.repository.ts`, `src/favorites/infrastructure/persistence/relational/repositories/favorite.repository.ts`, `src/favorites/infrastructure/persistence/relational/relational-persistence.module.ts`, `src/favorites/dto/list-favorites.dto.ts`, `src/favorites/favorites.service.ts`, `src/favorites/favorites.controller.ts`, `src/favorites/favorites.module.ts`
- Test: `src/favorites/favorites.service.spec.ts`, `test/user/favorites.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 (`FavoriteEntity`, `Kitchen.ratingAvg/ratingCount`), Task 3 (`PageQueryDto`, e2e `completeOrder`, `POST /orders/:id/review`), `KitchenMapper`, `KitchensService.findById`, `PointQueryDto` (`src/discovery/dto/discover-query.dto.ts`), `kitchenCard`, `haversineKm`, `roundCoord`.
- Produces:
  - `KitchenSummary.ratingAvg: number | null`, `KitchenSummary.ratingCount: number` (ürün kartının mutfağı dahil), `KitchenCard.isFavorite: boolean` (liste, detay, ürün detayındaki mutfak, favoriler).
  - `ViewerContext.favoriteKitchenIds: ReadonlySet<Kitchen['id']>`; `roundedDistanceKm(kitchen: Pick<Kitchen, 'latitude' | 'longitude'>, ctx: Pick<ViewerContext, 'point' | 'coordPrecision'>): number` (Faz 2 §8: yuvarlanmış noktaya).
  - `FavoriteRepository` (port): `add(userId, kitchenId)` (`ON CONFLICT DO NOTHING`), `remove(userId, kitchenId)`, `listKitchens(userId, page: FavoritePage): Promise<Kitchen[]>` (silinmemiş mutfaklar, en yeni favori üstte), `favoriteKitchenIds(userId, kitchenIds): Promise<string[]>`.
  - `FavoritesService`: `add(userId, kitchenId)`, `remove(userId, kitchenId)` (silinmiş/olmayan mutfak 404, duraklatılmış serbest), `list(userId, query: ListFavoritesQueryDto): Promise<InfinityPaginationResponseDto<KitchenCard>>`, `favoriteKitchenIds(userId, kitchenIds): Promise<Set<string>>`. `FavoritesModule` `FavoritesService`'i dışa açar; `DiscoveryModule` onu import eder.
  - Uçlar: `POST /kitchens/:id/favorite` (204), `DELETE /kitchens/:id/favorite` (204), `GET /favorites?lat&lng&page&limit`.

- [ ] **Step 1: Keşif kartları — test**

`src/discovery/presenters.spec.ts` — şu bloğu:

```ts
  kitchenDetail,
  productCard,
  productDetail,
} from './presenters';

const NOW = new Date('2026-10-12T09:30:00Z');
```

şununla değiştir:

```ts
  kitchenDetail,
  productCard,
  productDetail,
  roundedDistanceKm,
} from './presenters';

const NOW = new Date('2026-10-12T09:30:00Z');
```

`src/discovery/presenters.spec.ts` — ardından şu bloğu:

```ts
  pickupRadiusKm: 5,
  coordPrecision: 3,
  now: NOW,
};

const kitchen = Object.assign(new Kitchen(), {
```

şununla değiştir:

```ts
  pickupRadiusKm: 5,
  coordPrecision: 3,
  now: NOW,
  favoriteKitchenIds: new Set(['k1']),
};

const kitchen = Object.assign(new Kitchen(), {
```

`src/discovery/presenters.spec.ts` — ardından şu bloğu:

```ts
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
  isVerified: false,
});

const MAIN = Object.assign(new Category(), {
```

şununla değiştir:

```ts
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
  isVerified: false,
  ratingAvg: 4.8,
  ratingCount: 12,
});

const MAIN = Object.assign(new Category(), {
```

`src/discovery/presenters.spec.ts` — ardından şu bloğu:

```ts
    });
  });

  it('should not leak the exact address', () => {
    const card = kitchenCard(kitchen, 1, ctx);
    expect(card).not.toHaveProperty('fullAddress');
```

şununla değiştir:

```ts
    });
  });

  it('should carry the rating and the viewer’s heart', () => {
    expect(kitchenCard(kitchen, 1, ctx)).toMatchObject({
      ratingAvg: 4.8,
      ratingCount: 12,
      isFavorite: true,
    });
    expect(
      kitchenCard(kitchen, 1, { ...ctx, favoriteKitchenIds: new Set() })
        .isFavorite,
    ).toBe(false);
  });

  it('should not leak the exact address', () => {
    const card = kitchenCard(kitchen, 1, ctx);
    expect(card).not.toHaveProperty('fullAddress');
```

`src/discovery/presenters.spec.ts` — ardından şu bloğu:

```ts
    expect(productCard(product(), kitchen, 1, ctx)).toMatchObject({
      photo: { id: 'f2' },
      allergenWarnings: [Allergen.milk],
      kitchen: { id: 'k1', distanceKm: 1, isOpenNow: true },
    });
  });

```

şununla değiştir:

```ts
    expect(productCard(product(), kitchen, 1, ctx)).toMatchObject({
      photo: { id: 'f2' },
      allergenWarnings: [Allergen.milk],
      kitchen: {
        id: 'k1',
        distanceKm: 1,
        isOpenNow: true,
        ratingAvg: 4.8,
        ratingCount: 12,
      },
    });
  });

```

`src/discovery/presenters.spec.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    expect(detail.kitchen).toMatchObject({ id: 'k1', deliveryFeeKurus: 0 });
  });
});
```

şununla değiştir:

```ts
    expect(detail.kitchen).toMatchObject({ id: 'k1', deliveryFeeKurus: 0 });
  });
});

describe('roundedDistanceKm', () => {
  it('should measure to the rounded kitchen point', () => {
    const exact = roundedDistanceKm(
      { latitude: 40.98771, longitude: 29.02249 },
      { point: { latitude: 40.988, longitude: 29.022 }, coordPrecision: 3 },
    );

    expect(exact).toBe(0);
  });
});
```

Run: `npx jest src/discovery/presenters.spec.ts` → FAIL (`roundedDistanceKm` yok, kartta `ratingAvg`/`isFavorite` yok; tip hatası `favoriteKitchenIds`).

- [ ] **Step 2: Keşif kartları — kod**

`src/discovery/views.ts` — şu bloğu:

```ts
    description: 'Kapalıysa bir sonraki açılış',
  })
  opensAt: Date | null;
}

export class KitchenCard extends KitchenSummary {
```

şununla değiştir:

```ts
    description: 'Kapalıysa bir sonraki açılış',
  })
  opensAt: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tek ondalık; ratingCount 0 iken null ("Yeni")',
  })
  ratingAvg: number | null;

  @ApiProperty({ type: Number })
  ratingCount: number;
}

export class KitchenCard extends KitchenSummary {
```

`src/discovery/views.ts` — ardından şu bloğu:

```ts

  @ApiProperty({ type: Boolean })
  isVerified: boolean;
}

export class ProductCard {
```

şununla değiştir:

```ts

  @ApiProperty({ type: Boolean })
  isVerified: boolean;

  @ApiProperty({ type: Boolean, description: 'Kullanıcının favorisinde' })
  isFavorite: boolean;
}

export class ProductCard {
```

`src/discovery/presenters.ts` — dosyanın başındaki şu bloğu:

```ts
import { Allergen } from '../catalog/catalog.enums';
import { deliveryFeeFor } from '../catalog/delivery';
import { LatLng, roundCoord, roundDistance } from '../catalog/geo';
import { openingState } from '../catalog/opening-state';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
```

şununla değiştir:

```ts
import { Allergen } from '../catalog/catalog.enums';
import { deliveryFeeFor } from '../catalog/delivery';
import { LatLng, haversineKm, roundCoord, roundDistance } from '../catalog/geo';
import { openingState } from '../catalog/opening-state';
import { Kitchen } from '../kitchens/domain/kitchen';
import { Product } from '../products/domain/product';
```

`src/discovery/presenters.ts` — ardından şu bloğu:

```ts
  pickupRadiusKm: number;
  coordPrecision: number;
  now: Date;
};

export function kitchenSummary(
  kitchen: Kitchen,
```

şununla değiştir:

```ts
  pickupRadiusKm: number;
  coordPrecision: number;
  now: Date;
  /** Of the kitchens being shown, the ones the viewer favorited. */
  favoriteKitchenIds: ReadonlySet<Kitchen['id']>;
};

/** Measured to the rounded point, so probing cannot recover the exact one. */
export function roundedDistanceKm(
  kitchen: Pick<Kitchen, 'latitude' | 'longitude'>,
  ctx: Pick<ViewerContext, 'point' | 'coordPrecision'>,
): number {
  return haversineKm(ctx.point, {
    latitude: roundCoord(kitchen.latitude, ctx.coordPrecision),
    longitude: roundCoord(kitchen.longitude, ctx.coordPrecision),
  });
}

export function kitchenSummary(
  kitchen: Kitchen,
```

`src/discovery/presenters.ts` — ardından şu bloğu:

```ts
    distanceKm: roundDistance(distanceKm),
    isOpenNow: opening.isOpenNow,
    opensAt: opening.opensAt,
  });
}

```

şununla değiştir:

```ts
    distanceKm: roundDistance(distanceKm),
    isOpenNow: opening.isOpenNow,
    opensAt: opening.opensAt,
    ratingAvg: kitchen.ratingAvg,
    ratingCount: kitchen.ratingCount,
  });
}

```

`src/discovery/presenters.ts` — ardından şu bloğu:

```ts
      deliveryFeeKurus,
      freeDeliveryMinKurus: kitchen.freeDeliveryMinKurus,
      isVerified: kitchen.isVerified,
    },
  );
}
```

şununla değiştir:

```ts
      deliveryFeeKurus,
      freeDeliveryMinKurus: kitchen.freeDeliveryMinKurus,
      isVerified: kitchen.isVerified,
      isFavorite: ctx.favoriteKitchenIds.has(kitchen.id),
    },
  );
}
```

Run: `npx jest src/discovery/presenters.spec.ts` → PASS (9 test). (`discovery.service.ts` Step 5'e kadar tip hatası verir.)

- [ ] **Step 3: Repository ve sorgu DTO'su**

`src/favorites/infrastructure/persistence/favorite.repository.ts` — dosyanın tamamı:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { User } from '../../../users/domain/user';

export type FavoritePage = { offset: number; limit: number };

export abstract class FavoriteRepository {
  /** Idempotent: a second add changes nothing. */
  abstract add(userId: User['id'], kitchenId: Kitchen['id']): Promise<void>;

  /** Idempotent. */
  abstract remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void>;

  /** The user's favorite kitchens that still exist, most recently added first. */
  abstract listKitchens(
    userId: User['id'],
    page: FavoritePage,
  ): Promise<Kitchen[]>;

  /** Which of `kitchenIds` the user has favorited. */
  abstract favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
  ): Promise<Kitchen['id'][]>;
}
```

`src/favorites/infrastructure/persistence/relational/repositories/favorite.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { KitchenMapper } from '../../../../../kitchens/infrastructure/persistence/relational/mappers/kitchen.mapper';
import { User } from '../../../../../users/domain/user';
import { FavoritePage, FavoriteRepository } from '../../favorite.repository';
import { FavoriteEntity } from '../entities/favorite.entity';

@Injectable()
export class FavoriteRelationalRepository implements FavoriteRepository {
  constructor(
    @InjectRepository(FavoriteEntity)
    private readonly favorites: Repository<FavoriteEntity>,
  ) {}

  async add(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    await this.favorites
      .createQueryBuilder()
      .insert()
      .into(FavoriteEntity)
      .values({ userId: Number(userId), kitchenId })
      .orIgnore()
      .execute();
  }

  async remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    await this.favorites.delete({ userId: Number(userId), kitchenId });
  }

  async listKitchens(
    userId: User['id'],
    page: FavoritePage,
  ): Promise<Kitchen[]> {
    const rows = await this.favorites
      .createQueryBuilder('f')
      .innerJoinAndSelect('f.kitchen', 'k')
      .where('f."userId" = :userId', { userId: Number(userId) })
      .andWhere('k."deletedAt" IS NULL')
      .orderBy('f.createdAt', 'DESC')
      .addOrderBy('f.id', 'DESC')
      .offset(page.offset)
      .limit(page.limit)
      .getMany();

    return rows.map((row) =>
      KitchenMapper.toDomain(row.kitchen as KitchenEntity),
    );
  }

  async favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
  ): Promise<Kitchen['id'][]> {
    if (kitchenIds.length === 0) {
      return [];
    }

    const rows = await this.favorites.find({
      select: { kitchenId: true },
      where: { userId: Number(userId), kitchenId: In(kitchenIds) },
    });
    return rows.map((row) => row.kitchenId);
  }
}
```

`src/favorites/infrastructure/persistence/relational/relational-persistence.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoriteRepository } from '../favorite.repository';
import { FavoriteEntity } from './entities/favorite.entity';
import { FavoriteRelationalRepository } from './repositories/favorite.repository';

@Module({
  imports: [TypeOrmModule.forFeature([FavoriteEntity])],
  providers: [
    {
      provide: FavoriteRepository,
      useClass: FavoriteRelationalRepository,
    },
  ],
  exports: [FavoriteRepository],
})
export class RelationalFavoritePersistenceModule {}
```

`src/favorites/dto/list-favorites.dto.ts` — dosyanın tamamı (`IntersectionType` doğrulama, dönüştürme ve varsayılan değerleri devralır):

```ts
import { IntersectionType } from '@nestjs/swagger';
import { PointQueryDto } from '../../discovery/dto/discover-query.dto';
import { PageQueryDto } from '../../orders/dto/list-orders.dto';

/** GET /favorites — the selected address measures the distances, like /discover. */
export class ListFavoritesQueryDto extends IntersectionType(
  PointQueryDto,
  PageQueryDto,
) {}
```

- [ ] **Step 4: Servis — test**

`src/favorites/favorites.service.spec.ts` — dosyanın tamamı:

```ts
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { FavoritesService } from './favorites.service';
import { FavoriteRepository } from './infrastructure/persistence/favorite.repository';

const kitchen = Object.assign(new Kitchen(), {
  id: 'k1',
  name: 'Ayşe Teyze Mutfağı',
  district: 'Kadıköy',
  neighborhood: 'Caferağa',
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: false,
  deliveryTiers: [],
  hours: [],
  isPaused: true,
  isVerified: false,
  coverPhoto: null,
  freeDeliveryMinKurus: null,
  ratingAvg: null,
  ratingCount: 0,
});

const build = () => {
  const favorites = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    listKitchens: jest.fn().mockResolvedValue([kitchen]),
    favoriteKitchenIds: jest.fn().mockResolvedValue(['k1']),
  };
  const kitchens = { findById: jest.fn().mockResolvedValue(kitchen) };
  const config = {
    getOrThrow: (key: string) =>
      ({ 'discovery.pickupRadiusKm': 5, 'discovery.coordPrecision': 3 })[key],
  };

  const service = new FavoritesService(
    favorites as unknown as FavoriteRepository,
    kitchens as unknown as KitchensService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, favorites, kitchens };
};

describe('FavoritesService', () => {
  it('should add and remove a live kitchen, paused or not', async () => {
    const { service, favorites } = build();

    await service.add(9, 'k1');
    await service.remove(9, 'k1');

    expect(favorites.add).toHaveBeenCalledWith(9, 'k1');
    expect(favorites.remove).toHaveBeenCalledWith(9, 'k1');
  });

  it('should 404 a kitchen that is gone', async () => {
    const { service, kitchens, favorites } = build();
    kitchens.findById.mockResolvedValue(null);

    await expect(service.add(9, 'k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(9, 'k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(favorites.add).not.toHaveBeenCalled();
  });

  it('should list favorites as discovery cards measured from the given point', async () => {
    const { service, favorites } = build();

    const page = await service.list(9, {
      lat: 40.988,
      lng: 29.022,
      page: 2,
      limit: 1,
    });

    expect(favorites.listKitchens).toHaveBeenCalledWith(9, {
      offset: 1,
      limit: 1,
    });
    expect(page).toEqual({
      data: [
        expect.objectContaining({
          id: 'k1',
          distanceKm: 0,
          isPaused: true,
          isFavorite: true,
          ratingAvg: null,
          ratingCount: 0,
          latitude: 40.988,
        }),
      ],
      hasNextPage: true,
    });
  });

  it('should answer which kitchens are favorites as a set', async () => {
    const { service } = build();

    await expect(service.favoriteKitchenIds(9, ['k1', 'k2'])).resolves.toEqual(
      new Set(['k1']),
    );
  });
});
```

Run: `npx jest src/favorites` → FAIL (modül yok).

- [ ] **Step 5: Servis, controller, modül ve keşif servisi**

Favori listesi uzaklık filtresi uygulamaz (taşınmış müşteri favorisini görmeye devam eder); mesafe, `pickupAvailable` ve `deliveryAvailable` verilen noktaya göre hesaplanır. Keşif servisi kalbi yalnız kart döndüren uçlar için sorar (ürün kartının mutfak özetinde kalp yok).

`src/favorites/favorites.service.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { kitchenCard, roundedDistanceKm } from '../discovery/presenters';
import { KitchenCard } from '../discovery/views';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { ListFavoritesQueryDto } from './dto/list-favorites.dto';
import { FavoriteRepository } from './infrastructure/persistence/favorite.repository';

/** Kitchens a customer follows; only kitchens, never products. */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly favoriteRepository: FavoriteRepository,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** Idempotent; a deleted or unknown kitchen is a 404 (a paused one is fine). */
  async add(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    const kitchen = await orNotFound(this.kitchensService.findById(kitchenId));
    await this.favoriteRepository.add(userId, kitchen.id);
  }

  async remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    const kitchen = await orNotFound(this.kitchensService.findById(kitchenId));
    await this.favoriteRepository.remove(userId, kitchen.id);
  }

  /** Discovery cards for the user's favorites, newest first; deleted kitchens drop out. */
  async list(
    userId: User['id'],
    query: ListFavoritesQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    const kitchens = await this.favoriteRepository.listKitchens(userId, {
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });
    const ctx = {
      userId,
      allergenPreferences: [],
      point: { latitude: query.lat, longitude: query.lng },
      pickupRadiusKm: this.configService.getOrThrow(
        'discovery.pickupRadiusKm',
        { infer: true },
      ),
      coordPrecision: this.configService.getOrThrow(
        'discovery.coordPrecision',
        { infer: true },
      ),
      now: new Date(),
      favoriteKitchenIds: new Set(kitchens.map((kitchen) => kitchen.id)),
    };

    return infinityPagination(
      kitchens.map((kitchen) =>
        kitchenCard(kitchen, roundedDistanceKm(kitchen, ctx), ctx),
      ),
      { page: query.page, limit: query.limit },
    );
  }

  async favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
  ): Promise<Set<Kitchen['id']>> {
    return new Set(
      await this.favoriteRepository.favoriteKitchenIds(userId, kitchenIds),
    );
  }
}
```

`src/favorites/favorites.controller.ts` — dosyanın tamamı:

```ts
import {
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { KitchenCard } from '../discovery/views';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { ListFavoritesQueryDto } from './dto/list-favorites.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('Favorites')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  version: '1',
})
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post('kitchens/:id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  add(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.favoritesService.add(request.user.id, id);
  }

  @Delete('kitchens/:id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.favoritesService.remove(request.user.id, id);
  }

  @Get('favorites')
  @ApiOkResponse({ type: InfinityPaginationResponse(KitchenCard) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListFavoritesQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    return this.favoritesService.list(request.user.id, query);
  }
}
```

`src/favorites/favorites.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { KitchensModule } from '../kitchens/kitchens.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { RelationalFavoritePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    // do not remove this comment
    RelationalFavoritePersistenceModule,
    KitchensModule,
  ],
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
```

`src/discovery/discovery.service.ts` — dosyanın başındaki şu bloğu:

```ts
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { likePattern } from '../catalog/fold-turkish';
import { haversineKm, roundCoord } from '../catalog/geo';
import { istanbulClock } from '../catalog/opening-state';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { User } from '../users/domain/user';
import { UsersService } from '../users/users.service';
```

şununla değiştir:

```ts
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { likePattern } from '../catalog/fold-turkish';
import { istanbulClock } from '../catalog/opening-state';
import { AllConfigType } from '../config/config.type';
import { FavoritesService } from '../favorites/favorites.service';
import { Kitchen } from '../kitchens/domain/kitchen';
import { User } from '../users/domain/user';
import { UsersService } from '../users/users.service';
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
  kitchenDetail,
  productCard,
  productDetail,
} from './presenters';
import {
  KitchenCard,
```

şununla değiştir:

```ts
  kitchenDetail,
  productCard,
  productDetail,
  roundedDistanceKm,
} from './presenters';
import {
  KitchenCard,
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

```

şununla değiştir:

```ts
  constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly usersService: UsersService,
    private readonly favoritesService: FavoritesService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
    const hits = await this.discoveryRepository.findKitchens(
      this.filter(ctx, query),
    );

    return infinityPagination(
      hits.map((hit) => kitchenCard(hit.kitchen, hit.distanceKm, ctx)),
      { page: query.page, limit: query.limit },
    );
  }
```

şununla değiştir:

```ts
    const hits = await this.discoveryRepository.findKitchens(
      this.filter(ctx, query),
    );
    const viewer = await this.withFavorites(
      ctx,
      hits.map((hit) => hit.kitchen.id),
    );

    return infinityPagination(
      hits.map((hit) => kitchenCard(hit.kitchen, hit.distanceKm, viewer)),
      { page: query.page, limit: query.limit },
    );
  }
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
    const kitchen = await orNotFound(
      this.discoveryRepository.findKitchenById(id),
    );
    const distanceKm = this.distanceTo(kitchen, ctx);

    if (
      !this.isOwner(kitchen, ctx) &&
```

şununla değiştir:

```ts
    const kitchen = await orNotFound(
      this.discoveryRepository.findKitchenById(id),
    );
    const distanceKm = roundedDistanceKm(kitchen, ctx);

    if (
      !this.isOwner(kitchen, ctx) &&
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
      kitchen.id,
    );

    return kitchenDetail(kitchen, distanceKm, products, ctx);
  }

  async product(
```

şununla değiştir:

```ts
      kitchen.id,
    );

    return kitchenDetail(
      kitchen,
      distanceKm,
      products,
      await this.withFavorites(ctx, [kitchen.id]),
    );
  }

  async product(
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
    const { product, kitchen } = await orNotFound(
      this.discoveryRepository.findProductById(id),
    );
    const distanceKm = this.distanceTo(kitchen, ctx);
    const visible =
      isKitchenReachable(kitchen, distanceKm, ctx.pickupRadiusKm) &&
      isProductListed(product);
```

şununla değiştir:

```ts
    const { product, kitchen } = await orNotFound(
      this.discoveryRepository.findProductById(id),
    );
    const distanceKm = roundedDistanceKm(kitchen, ctx);
    const visible =
      isKitchenReachable(kitchen, distanceKm, ctx.pickupRadiusKm) &&
      isProductListed(product);
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
      throw notFound();
    }

    return productDetail(product, kitchen, distanceKm, ctx);
  }

  /** Measured to the rounded point, so probing cannot recover the exact one. */
  private distanceTo(kitchen: Kitchen, ctx: ViewerContext): number {
    return haversineKm(ctx.point, {
      latitude: roundCoord(kitchen.latitude, ctx.coordPrecision),
      longitude: roundCoord(kitchen.longitude, ctx.coordPrecision),
    });
  }

  private isOwner(kitchen: Kitchen, ctx: ViewerContext): boolean {
```

şununla değiştir:

```ts
      throw notFound();
    }

    return productDetail(
      product,
      kitchen,
      distanceKm,
      await this.withFavorites(ctx, [kitchen.id]),
    );
  }

  /** The heart on kitchen cards: which of these the viewer favorited. */
  private async withFavorites(
    ctx: ViewerContext,
    kitchenIds: Kitchen['id'][],
  ): Promise<ViewerContext> {
    return {
      ...ctx,
      favoriteKitchenIds: await this.favoritesService.favoriteKitchenIds(
        ctx.userId,
        kitchenIds,
      ),
    };
  }

  private isOwner(kitchen: Kitchen, ctx: ViewerContext): boolean {
```

`src/discovery/discovery.service.ts` — ardından şu bloğu:

```ts
        { infer: true },
      ),
      now: new Date(),
    };
  }

```

şununla değiştir:

```ts
        { infer: true },
      ),
      now: new Date(),
      favoriteKitchenIds: new Set(),
    };
  }

```

`src/discovery/discovery.module.ts` — dosyanın başındaki şu bloğu:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KitchenEntity } from '../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { UsersModule } from '../users/users.module';
```

şununla değiştir:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoritesModule } from '../favorites/favorites.module';
import { KitchenEntity } from '../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { UsersModule } from '../users/users.module';
```

`src/discovery/discovery.module.ts` — ardından şu bloğu:

```ts
  imports: [
    TypeOrmModule.forFeature([KitchenEntity, ProductEntity]),
    UsersModule,
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DiscoveryRepository],
```

şununla değiştir:

```ts
  imports: [
    TypeOrmModule.forFeature([KitchenEntity, ProductEntity]),
    UsersModule,
    FavoritesModule,
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DiscoveryRepository],
```

`src/app.module.ts` — şu bloğu:

```ts

import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ReviewsModule,
    PaymentsModule,
    OrdersModule,
```

şununla değiştir:

```ts

import { ReviewsModule } from './reviews/reviews.module';

import { FavoritesModule } from './favorites/favorites.module';

@Module({
  imports: [
    FavoritesModule,
    ReviewsModule,
    PaymentsModule,
    OrdersModule,
```

Run: `npx jest src/favorites src/discovery && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: PASS (4 + 15 test), tip hatası yok, lint temiz.

- [ ] **Step 6: e2e — favoriler ve keşifte puan**

`test/user/favorites.e2e-spec.ts` — dosyanın tamamı:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Spot,
  addProduct,
  categoryId,
  completeOrder,
  northOf,
  openKitchen,
  phoneLogin,
  randomSpot,
  testDatabase,
  uniquePhone,
} from '../utils/orders';

type Card = { id: string } & Record<string, unknown>;

describe('Favorites and kitchen ratings', () => {
  const app = APP_URL;
  const db = testDatabase();
  const HOME: Spot = randomSpot();
  const near = northOf(HOME, 1);
  const point = `lat=${near.latitude}&lng=${near.longitude}`;
  let cook: string;
  let secondCook: string;
  let customer: string;
  let kitchenId: string;
  let secondKitchenId: string;
  let mantiId: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const del = (path: string, token: string) =>
    request(app).delete(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const favoriteIds = async (): Promise<string[]> => {
    const { body } = await get(`/favorites?${point}`, customer).expect(200);
    return body.data.data.map((card: Card) => card.id);
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90567'));
    secondCook = await phoneLogin(uniquePhone('+90568'));
    customer = await phoneLogin(uniquePhone('+90569'));

    kitchenId = await openKitchen(cook, HOME);
    secondKitchenId = await openKitchen(secondCook, northOf(HOME, 2));
    mantiId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should add a favorite once however often it is sent', async () => {
    await post(`/kitchens/${kitchenId}/favorite`, customer).expect(204);
    await post(`/kitchens/${kitchenId}/favorite`, customer).expect(204);

    const [{ count }] = await db.query(
      `SELECT COUNT(*)::int AS count FROM "favorite" f
       JOIN "kitchen" k ON k."id" = f."kitchenId"
       WHERE k."id" = $1`,
      [kitchenId],
    );
    expect(count).toBe(1);
  });

  it('should 404 an unknown kitchen', () =>
    post(
      '/kitchens/00000000-0000-4000-8000-000000000000/favorite',
      customer,
    ).expect(404));

  it('should list favorites as kitchen cards, newest first', async () => {
    await post(`/kitchens/${secondKitchenId}/favorite`, customer).expect(204);

    await get(`/favorites?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data.map((card: Card) => card.id)).toEqual([
          secondKitchenId,
          kitchenId,
        ]);
        expect(body.data.data[1]).toMatchObject({
          name: 'Sipariş Mutfağı',
          isFavorite: true,
          isOpenNow: true,
          ratingAvg: null,
          ratingCount: 0,
          pickupAvailable: true,
        });
        expect(body.data.data[1].distanceKm).toBeCloseTo(1, 0);
        expect(body.data.data[1]).not.toHaveProperty('fullAddress');
        expect(body.data.hasNextPage).toBe(false);
      });
  });

  it('should show the heart on discovery cards and the detail', async () => {
    await get(`/discover/kitchens?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        const mine = body.data.data.find((card: Card) => card.id === kitchenId);
        expect(mine).toMatchObject({ isFavorite: true, ratingCount: 0 });
      });

    await get(`/discover/kitchens/${kitchenId}?${point}`, cook)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.isFavorite).toBe(false);
      });
  });

  it('should keep a paused kitchen in the list', async () => {
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(200);

    await get(`/favorites?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        const card = body.data.data.find((c: Card) => c.id === kitchenId);
        expect(card).toMatchObject({ isPaused: true, isOpenNow: false });
      });

    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: false })
      .expect(200);
  });

  it('should rate the kitchen on discovery once it is reviewed', async () => {
    const orderId = await completeOrder(cook, customer, {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId: mantiId, quantity: 1 }],
    });
    await post(`/orders/${orderId}/review`, customer)
      .send({ rating: 4 })
      .expect(201);

    await get(`/discover/kitchens/${kitchenId}?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      });

    await get(`/discover/products?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        const dish = body.data.data.find((p: Card) => p.id === mantiId);
        expect(dish.kitchen).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      });

    // PATCH /kitchens/me leaves the rating to the review writes.
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ description: 'Ev yemekleri' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      });
  });

  it('should remove a favorite once however often it is sent', async () => {
    await del(`/kitchens/${kitchenId}/favorite`, customer).expect(204);
    await del(`/kitchens/${kitchenId}/favorite`, customer).expect(204);

    expect(await favoriteIds()).toEqual([secondKitchenId]);
  });

  it('should drop a deleted kitchen from the list', async () => {
    await request(app)
      .delete('/api/v1/auth/me')
      .auth(secondCook, { type: 'bearer' })
      .expect(204);

    expect(await favoriteIds()).toEqual([]);
    await post(`/kitchens/${secondKitchenId}/favorite`, customer).expect(404);
  });
});
```

Run: `npm run test:e2e -- --runInBand test/user/favorites.e2e-spec.ts`
Expected: PASS (8 test).

- [ ] **Step 7: Tüm paket ve commit**

Run: `npm run lint && npm test && npm run test:e2e -- --runInBand` → temiz, PASS (Faz 2 keşif e2e'si yeni alanlardan etkilenmez).

```bash
git add src/favorites src/discovery src/app.module.ts test/user/favorites.e2e-spec.ts
git commit -m "feat(favorites): follow kitchens and show ratings on discovery cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sorun bildirimi, destek maili, admin çözümü ve kısmi iade

**Files:**
- Create: `src/payments/payment-rules.ts`; Test: `src/payments/payment-rules.spec.ts`
- Modify: `src/payments/infrastructure/persistence/payment.repository.ts`, `src/payments/infrastructure/persistence/relational/repositories/payment.repository.ts`, `src/payments/payments.service.ts`, `src/payments/payments.service.spec.ts`
- Create: `src/order-issues/infrastructure/persistence/order-issue.repository.ts`, `src/order-issues/infrastructure/persistence/relational/repositories/order-issue.repository.ts`, `src/order-issues/infrastructure/persistence/relational/relational-persistence.module.ts`
- Create: `src/mail/mail-templates/issue-reported.hbs`; Modify: `src/mail/mail.service.ts`
- Create: `src/order-issues/dto/create-order-issue.dto.ts`, `src/order-issues/dto/admin-order-issues.dto.ts`, `src/order-issues/views.ts`, `src/order-issues/presenters.ts`, `src/order-issues/order-issue.fixture.ts`, `src/order-issues/order-issues.service.ts`, `src/order-issues/order-issues.controller.ts`, `src/order-issues/admin-order-issues.controller.ts`, `src/order-issues/order-issues.module.ts`
- Test: `src/order-issues/order-issues.service.spec.ts`, `test/user/order-issues.e2e-spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 (`canReportIssue`, `issueNotAllowed`, `issueClosed`, `photosByIds`, `IssueCategory`, `IssueResolution`, `IssueStatus`, `trust.issueWindowHours`, `trust.supportEmail`), Task 2 (`OrderIssue`, `NewOrderIssue`, `OrderIssueResolution`, `OrderIssueEntity`, `OrderIssueMapper`, `Payment.refundedKurus`), Task 3 (`OrderRepository` dışa açık, `PageQueryDto`, e2e yardımcıları), `PaymentProvider.refund`, `MailerService.sendMail`, `MailData`.
- Produces:
  - `canRefund(payment: Pick<Payment, 'status' | 'amountKurus' | 'refundedKurus'>, amountKurus: number): boolean`.
  - `PaymentRepository.update` artık `refundedKurus` da yazar; `PaymentRepository.refundPartial(orderId, amountKurus, refund: (payment: Payment) => Promise<void>): Promise<Payment | null>` (ödeme satırı kilitli; `canRefund` değilse null).
  - `PaymentsService.refund(orderId)` artık yalnız kalan tutarı iade eder ve `refundedKurus = amountKurus` yazar; `PaymentsService.refundPartial(orderId, amountKurus): Promise<Payment>` (422 `refundKurus: exceedsPaid`, sağlayıcı reddi 502 `refundFailed`).
  - `OrderIssueRepository` (port): `create(issue: NewOrderIssue): Promise<OrderIssue>` (açık kayıt varken `DuplicateOpenIssueError`), `findById(id)`, `hasOpen(orderId): Promise<boolean>`, `list(status: IssueStatus | undefined, page: IssuePage): Promise<OrderIssueWithOrder[]>`, `resolve(id, resolution: OrderIssueResolution, beforeClose: (issue: OrderIssue) => Promise<void>): Promise<OrderIssueWithOrder | null>`; tipler `IssuePage`, `IssueOrder = Pick<Order, 'id' | 'code' | 'kitchenId' | 'totalKurus'>`, `OrderIssueWithOrder = { issue: OrderIssue; order: IssueOrder }`. `OrderIssuesModule` `RelationalOrderIssuePersistenceModule`'ü dışa açar.
  - `MailService.issueReported(mailData: MailData<{ issueId; orderCode; category; requestedResolution; description }>): Promise<void>`.
  - `OrderIssuesService`: `create(customerId, orderId, dto: CreateOrderIssueDto): Promise<IssueView>`, `list(query: ListOrderIssuesQueryDto)`, `resolve(id, dto: ResolveOrderIssueDto): Promise<AdminIssueView>`.
  - Görünümler: `IssueSummaryView { id, category, requestedResolution, status, refundKurus, adminNote, createdAt, resolvedAt }` (Task 6 sipariş detayında), `IssueView` (+ `description`, `photos`), `AdminIssueView` (+ `order: IssueOrderView { id, code, kitchenId, totalKurus }`); presenter'lar `issueSummaryView(issue)`, `issueView(issue)`, `adminIssueView({ issue, order })`. (İsimler Faz 3'ün teklif görünümü `OrderIssueView` ile Swagger şemasında çakışmasın diye `Issue…`.)
  - Uçlar: `POST /orders/:id/issues` (201), `GET /admin/issues?status&page&limit`, `PATCH /admin/issues/:id { status: resolved | rejected, refundKurus?, adminNote? }` (200).

- [ ] **Step 1: İade sınırı — test**

`src/payments/payment-rules.spec.ts` — dosyanın tamamı:

```ts
import { PaymentStatus } from './domain/payment';
import { canRefund } from './payment-rules';

const paid = {
  status: PaymentStatus.paid,
  amountKurus: 14700,
  refundedKurus: 0,
};

describe('canRefund', () => {
  it('should allow refunds up to what was paid, in steps', () => {
    expect(canRefund(paid, 14700)).toBe(true);
    expect(canRefund({ ...paid, refundedKurus: 5000 }, 9700)).toBe(true);
  });

  it('should refuse going past what was paid', () => {
    expect(canRefund(paid, 14701)).toBe(false);
    expect(canRefund({ ...paid, refundedKurus: 5000 }, 9701)).toBe(false);
  });

  it('should refuse a non-positive amount', () => {
    expect(canRefund(paid, 0)).toBe(false);
    expect(canRefund(paid, -100)).toBe(false);
  });

  it('should refuse a payment that is no longer paid', () => {
    for (const status of [
      PaymentStatus.refunded,
      PaymentStatus.refundFailed,
      PaymentStatus.failed,
    ]) {
      expect(canRefund({ ...paid, status }, 100)).toBe(false);
    }
  });
});
```

Run: `npx jest src/payments/payment-rules.spec.ts` → FAIL (modül yok).

- [ ] **Step 2: İade sınırı — kod**

`src/payments/payment-rules.ts` — dosyanın tamamı:

```ts
import { Payment, PaymentStatus } from './domain/payment';

/**
 * A partial refund needs a payment that is still `paid` and must keep the
 * refunds within what was paid (a full refund sets refundedKurus to amountKurus).
 */
export function canRefund(
  payment: Pick<Payment, 'status' | 'amountKurus' | 'refundedKurus'>,
  amountKurus: number,
): boolean {
  return (
    payment.status === PaymentStatus.paid &&
    amountKurus > 0 &&
    payment.refundedKurus + amountKurus <= payment.amountKurus
  );
}
```

Run: `npx jest src/payments/payment-rules.spec.ts` → PASS (4 test).

- [ ] **Step 3: Kısmi iade — servis testi**

`src/payments/payments.service.spec.ts` — dosyanın başındaki şu bloğu:

```ts
import { HttpException, Logger } from '@nestjs/common';
import { Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentsService } from './payments.service';
```

şununla değiştir:

```ts
import {
  HttpException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentsService } from './payments.service';
```

`src/payments/payments.service.spec.ts` — ardından şu bloğu:

```ts
    provider: 'dev',
    providerRef: 'dev_ref',
    amountKurus: 29400,
    status: PaymentStatus.paid,
    paidAt: new Date(),
    refundedAt: null,
```

şununla değiştir:

```ts
    provider: 'dev',
    providerRef: 'dev_ref',
    amountKurus: 29400,
    refundedKurus: 0,
    status: PaymentStatus.paid,
    paidAt: new Date(),
    refundedAt: null,
```

`src/payments/payments.service.spec.ts` — ardından şu bloğu:

```ts
  const repository = {
    findByOrderId: jest.fn().mockResolvedValue(paid()),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PaymentsService(
    repository as unknown as PaymentRepository,
```

şununla değiştir:

```ts
  const repository = {
    findByOrderId: jest.fn().mockResolvedValue(paid()),
    update: jest.fn().mockResolvedValue(undefined),
    refundPartial: jest
      .fn()
      .mockImplementation(
        async (
          _orderId,
          amountKurus,
          refund: (p: Payment) => Promise<void>,
        ) => {
          const payment = paid();
          await refund(payment);
          return { ...payment, refundedKurus: amountKurus };
        },
      ),
  };
  const service = new PaymentsService(
    repository as unknown as PaymentRepository,
```

`src/payments/payments.service.spec.ts` — ardından şu bloğu:

```ts
      expect(repository.update).toHaveBeenCalledWith('pay1', {
        status: PaymentStatus.refunded,
        refundedAt: expect.any(Date),
      });
    });

    it('should record refund_failed instead of throwing', async () => {
```

şununla değiştir:

```ts
      expect(repository.update).toHaveBeenCalledWith('pay1', {
        status: PaymentStatus.refunded,
        refundedAt: expect.any(Date),
        refundedKurus: 29400,
      });
    });

    it('should refund only what a partial refund left', async () => {
      const provider = new DevPaymentProvider(false);
      const refund = jest.spyOn(provider, 'refund');
      const { service, repository } = build(provider);
      repository.findByOrderId.mockResolvedValue(paid({ refundedKurus: 9400 }));

      await service.refund('o1');

      expect(refund).toHaveBeenCalledWith({
        providerRef: 'dev_ref',
        amountKurus: 20000,
      });
      expect(repository.update).toHaveBeenCalledWith(
        'pay1',
        expect.objectContaining({ refundedKurus: 29400 }),
      );
    });

    it('should record refund_failed instead of throwing', async () => {
```

`src/payments/payments.service.spec.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    });
  });
});
```

şununla değiştir:

```ts
    });
  });
});

describe('PaymentsService.refundPartial', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('should send the partial amount to the provider and return the payment', async () => {
    const provider = new DevPaymentProvider(false);
    const refund = jest.spyOn(provider, 'refund');
    const { service, repository } = build(provider);

    await expect(service.refundPartial('o1', 5000)).resolves.toMatchObject({
      refundedKurus: 5000,
    });
    expect(repository.refundPartial).toHaveBeenCalledWith(
      'o1',
      5000,
      expect.any(Function),
    );
    expect(refund).toHaveBeenCalledWith({
      providerRef: 'dev_ref',
      amountKurus: 5000,
    });
  });

  it('should 422 refundKurus beyond what was paid', async () => {
    const { service, repository } = build();
    repository.refundPartial.mockResolvedValue(null);

    const error = await service.refundPartial('o1', 99999).catch((e) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      status: 422,
      errors: { refundKurus: 'exceedsPaid' },
    });
  });

  it('should turn a refused refund into 502 refundFailed', async () => {
    const provider = new DevPaymentProvider(false);
    jest.spyOn(provider, 'refund').mockRejectedValue(new Error('down'));
    const { service } = build(provider);

    const error = await service.refundPartial('o1', 5000).catch((e) => e);

    expect((error as HttpException).getStatus()).toBe(502);
    expect((error as HttpException).getResponse()).toEqual({
      status: 502,
      error: 'refundFailed',
    });
  });
});
```

Run: `npx jest src/payments/payments.service.spec.ts` → FAIL (`refundPartial` yok; tam iade `refundedKurus` yazmıyor).

- [ ] **Step 4: Kısmi iade — repository ve servis**

Kısmi iade tek transaction'da: ödeme satırı `pessimistic_write` kilitli, `canRefund` değilse null (422), sonra sağlayıcı çağrılır (hatası her şeyi geri alır), sonra `refundedKurus` artar — tam tutara ulaşırsa `refunded`.

`src/payments/infrastructure/persistence/payment.repository.ts` — dosyanın sonundaki şu bloğu:

```ts

  abstract update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt'>>,
  ): Promise<void>;
}
```

şununla değiştir:

```ts

  abstract update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt' | 'refundedKurus'>>,
  ): Promise<void>;

  /**
   * One transaction with the payment row locked: null unless the payment is
   * `paid` and `refundedKurus + amountKurus` stays within what was paid;
   * otherwise `refund` runs (its error rolls everything back) and
   * `refundedKurus` grows — reaching the full amount makes it `refunded`.
   */
  abstract refundPartial(
    orderId: string,
    amountKurus: number,
    refund: (payment: Payment) => Promise<void>,
  ): Promise<NullableType<Payment>>;
}
```

`src/payments/infrastructure/persistence/relational/repositories/payment.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Payment, PaymentStatus } from '../../../../domain/payment';
import { canRefund } from '../../../../payment-rules';
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
    payload: Partial<Pick<Payment, 'status' | 'refundedAt' | 'refundedKurus'>>,
  ): Promise<void> {
    await this.paymentRepository.update({ id }, payload);
  }

  refundPartial(
    orderId: string,
    amountKurus: number,
    refund: (payment: Payment) => Promise<void>,
  ): Promise<NullableType<Payment>> {
    return this.paymentRepository.manager.transaction(async (manager) => {
      const entity = await manager.findOne(PaymentEntity, {
        where: { orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entity || !canRefund(entity, amountKurus)) {
        return null;
      }

      await refund(PaymentMapper.toDomain(entity));

      const refundedKurus = entity.refundedKurus + amountKurus;
      const changes: Partial<PaymentEntity> =
        refundedKurus === entity.amountKurus
          ? {
              refundedKurus,
              status: PaymentStatus.refunded,
              refundedAt: new Date(),
            }
          : { refundedKurus };
      await manager.update(PaymentEntity, { id: entity.id }, changes);

      return PaymentMapper.toDomain(Object.assign(entity, changes));
    });
  }
}
```

`src/payments/payments.service.ts` — dosyanın başındaki şu bloğu:

```ts
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NewPayment, Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentProvider } from './provider/payment-provider';
```

şununla değiştir:

```ts
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { NewPayment, Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentProvider } from './provider/payment-provider';
```

`src/payments/payments.service.ts` — ardından şu bloğu:

```ts
  }

  /**
   * Gives a closed order's money back. Never throws: a refused refund is
   * stored as `refund_failed` and logged — the order closes either way.
   */
  async refund(orderId: string): Promise<PaymentStatus | null> {
    const payment = await this.paymentRepository.findByOrderId(orderId);
```

şununla değiştir:

```ts
  }

  /**
   * Gives a closed order's money back — whatever a partial refund has not
   * returned yet. Never throws: a refused refund is stored as
   * `refund_failed` and logged — the order closes either way.
   */
  async refund(orderId: string): Promise<PaymentStatus | null> {
    const payment = await this.paymentRepository.findByOrderId(orderId);
```

`src/payments/payments.service.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
    try {
      await this.paymentProvider.refund({
        providerRef: payment.providerRef,
        amountKurus: payment.amountKurus - payment.refundedKurus,
      });
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.refunded,
        refundedAt: new Date(),
        refundedKurus: payment.amountKurus,
      });
      return PaymentStatus.refunded;
    } catch (error) {
```

`src/payments/payments.service.ts` — ardından şu bloğu:

```ts
    }
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    return this.paymentRepository.findByOrderId(orderId);
  }
```

şununla değiştir:

```ts
    }
  }

  /**
   * Gives part of a paid order's money back (an admin resolving an issue).
   * More than what is left → 422 `refundKurus: exceedsPaid` (also for a
   * payment that is not `paid` any more); a refused refund → 502
   * `refundFailed` and nothing changes.
   */
  async refundPartial(orderId: string, amountKurus: number): Promise<Payment> {
    let payment: Payment | null;

    try {
      payment = await this.paymentRepository.refundPartial(
        orderId,
        amountKurus,
        (current) =>
          this.paymentProvider.refund({
            providerRef: current.providerRef,
            amountKurus,
          }),
      );
    } catch (error) {
      this.logger.error(
        `Partial refund failed for order ${orderId}: ${reasonOf(error)}`,
      );
      throw new HttpException(
        { status: HttpStatus.BAD_GATEWAY, error: 'refundFailed' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!payment) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { refundKurus: 'exceedsPaid' },
      });
    }

    return payment;
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    return this.paymentRepository.findByOrderId(orderId);
  }
```

Run: `npx jest src/payments` → PASS (20 test).

- [ ] **Step 5: Sorun repository'si**

Admin kararı sorun satırı kilitliyken verilir: `beforeClose` (iade) hata atarsa kayıt açık kalır; iki admin aynı anda karar verirse ikincisi kilidi bekler, kaydı kapalı bulur ve null alır (çift iade yok).

`src/order-issues/infrastructure/persistence/order-issue.repository.ts` — dosyanın tamamı:

```ts
import { Order } from '../../../orders/domain/order';
import { IssueStatus } from '../../../trust/trust.enums';
import { NullableType } from '../../../utils/types/nullable.type';
import {
  NewOrderIssue,
  OrderIssue,
  OrderIssueResolution,
} from '../../domain/order-issue';

export type IssuePage = { offset: number; limit: number };

/** What the admin needs of the order next to its issue. */
export type IssueOrder = Pick<
  Order,
  'id' | 'code' | 'kitchenId' | 'totalKurus'
>;

export type OrderIssueWithOrder = { issue: OrderIssue; order: IssueOrder };

/** The order already has an open report (partial unique index). */
export class DuplicateOpenIssueError extends Error {}

export abstract class OrderIssueRepository {
  /** Inserts an open report; DuplicateOpenIssueError when one is already open. */
  abstract create(issue: NewOrderIssue): Promise<OrderIssue>;

  abstract findById(id: OrderIssue['id']): Promise<NullableType<OrderIssue>>;

  abstract hasOpen(orderId: Order['id']): Promise<boolean>;

  /** Newest first; every status when `status` is undefined. */
  abstract list(
    status: IssueStatus | undefined,
    page: IssuePage,
  ): Promise<OrderIssueWithOrder[]>;

  /**
   * One transaction with the issue row locked: null unless it is still open;
   * otherwise `beforeClose` runs (the refund — its error rolls back and the
   * issue stays open), then `resolution` is written.
   */
  abstract resolve(
    id: OrderIssue['id'],
    resolution: OrderIssueResolution,
    beforeClose: (issue: OrderIssue) => Promise<void>,
  ): Promise<NullableType<OrderIssueWithOrder>>;
}
```

`src/order-issues/infrastructure/persistence/relational/repositories/order-issue.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { IssueStatus } from '../../../../../trust/trust.enums';
import { NullableType } from '../../../../../utils/types/nullable.type';
import {
  NewOrderIssue,
  OrderIssue,
  OrderIssueResolution,
} from '../../../../domain/order-issue';
import {
  DuplicateOpenIssueError,
  IssuePage,
  OrderIssueRepository,
  OrderIssueWithOrder,
} from '../../order-issue.repository';
import { OrderIssueEntity } from '../entities/order-issue.entity';
import { OrderIssueMapper } from '../mappers/order-issue.mapper';

const isOpenIssueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string }).code === '23505' &&
  (error.driverError as { constraint?: string }).constraint ===
    'IDX_order_issue_open_order';

const withOrder = (entity: OrderIssueEntity): OrderIssueWithOrder => {
  const order = entity.order as OrderEntity;

  return {
    issue: OrderIssueMapper.toDomain(entity),
    order: {
      id: order.id,
      code: order.code,
      kitchenId: order.kitchenId,
      totalKurus: order.totalKurus,
    },
  };
};

@Injectable()
export class OrderIssueRelationalRepository implements OrderIssueRepository {
  constructor(
    @InjectRepository(OrderIssueEntity)
    private readonly issues: Repository<OrderIssueEntity>,
  ) {}

  async create(issue: NewOrderIssue): Promise<OrderIssue> {
    try {
      const entity = await this.issues.save(
        this.issues.create(OrderIssueMapper.toPersistence(issue)),
      );
      return OrderIssueMapper.toDomain(entity);
    } catch (error) {
      if (isOpenIssueViolation(error)) {
        throw new DuplicateOpenIssueError();
      }

      throw error;
    }
  }

  async findById(id: OrderIssue['id']): Promise<NullableType<OrderIssue>> {
    const entity = await this.issues.findOne({ where: { id } });
    return entity ? OrderIssueMapper.toDomain(entity) : null;
  }

  hasOpen(orderId: OrderIssue['orderId']): Promise<boolean> {
    return this.issues.exists({ where: { orderId, status: IssueStatus.open } });
  }

  async list(
    status: IssueStatus | undefined,
    page: IssuePage,
  ): Promise<OrderIssueWithOrder[]> {
    const entities = await this.issues.find({
      where: status ? { status } : {},
      relations: { order: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: page.offset,
      take: page.limit,
    });
    return entities.map(withOrder);
  }

  async resolve(
    id: OrderIssue['id'],
    resolution: OrderIssueResolution,
    beforeClose: (issue: OrderIssue) => Promise<void>,
  ): Promise<NullableType<OrderIssueWithOrder>> {
    const resolved = await this.issues.manager.transaction(async (manager) => {
      const entity = await manager.findOne(OrderIssueEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entity || entity.status !== IssueStatus.open) {
        return false;
      }

      await beforeClose(OrderIssueMapper.toDomain(entity));
      await manager.update(OrderIssueEntity, { id }, resolution);
      return true;
    });

    if (!resolved) {
      return null;
    }

    return withOrder(
      await this.issues.findOneOrFail({
        where: { id },
        relations: { order: true },
      }),
    );
  }
}
```

`src/order-issues/infrastructure/persistence/relational/relational-persistence.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderIssueRepository } from '../order-issue.repository';
import { OrderIssueEntity } from './entities/order-issue.entity';
import { OrderIssueRelationalRepository } from './repositories/order-issue.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OrderIssueEntity])],
  providers: [
    {
      provide: OrderIssueRepository,
      useClass: OrderIssueRelationalRepository,
    },
  ],
  exports: [OrderIssueRepository],
})
export class RelationalOrderIssuePersistenceModule {}
```

- [ ] **Step 6: Destek maili**

Destek ekibine gider; metin Türkçe sabit (kullanıcının dili değil), kategori ve çözüm enum değeriyle yazılır. Handlebars `strict` modda: şablondaki her alan `context`'te olmalı.

`src/mail/mail-templates/issue-reported.hbs` — dosyanın tamamı:

```handlebars
<!DOCTYPE html>
<html lang="tr">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{title}}</title>
</head>

<body style="margin:0;font-family:arial">
    <table style="border:0;width:100%">
        <tr style="background:#eeeeee">
            <td style="padding:20px;color:#808080;text-align:center;font-size:32px;font-weight:600">
                {{app_name}}
            </td>
        </tr>
        <tr>
            <td style="padding:20px;color:#333333;font-size:16px">
                <b>Sipariş:</b> {{orderCode}}<br>
                <b>Kategori:</b> {{category}}<br>
                <b>İstenen çözüm:</b> {{requestedResolution}}<br>
                <b>Kayıt:</b> {{issueId}}
            </td>
        </tr>
        <tr>
            <td style="padding:0 20px 20px;color:#333333;font-size:16px;white-space:pre-wrap">{{description}}</td>
        </tr>
    </table>
</body>

</html>
```

`src/mail/mail.service.ts` — dosyanın sonundaki şu bloğu:

```ts
      },
    });
  }
}
```

şununla değiştir:

```ts
      },
    });
  }

  /** A new issue report, to the support inbox (SUPPORT_EMAIL). */
  async issueReported(
    mailData: MailData<{
      issueId: string;
      orderCode: string;
      category: string;
      requestedResolution: string;
      description: string;
    }>,
  ): Promise<void> {
    const { issueId, orderCode, category, requestedResolution, description } =
      mailData.data;
    const title = `Sorun bildirimi · ${orderCode}`;

    await this.mailerService.sendMail({
      to: mailData.to,
      subject: title,
      text: [
        `Sipariş: ${orderCode}`,
        `Kategori: ${category}`,
        `İstenen çözüm: ${requestedResolution}`,
        `Kayıt: ${issueId}`,
        '',
        description,
      ].join('\n'),
      templatePath: path.join(
        this.configService.getOrThrow('app.workingDirectory', {
          infer: true,
        }),
        'src',
        'mail',
        'mail-templates',
        'issue-reported.hbs',
      ),
      context: {
        title,
        app_name: this.configService.get('app.name', { infer: true }),
        issueId,
        orderCode,
        category,
        requestedResolution,
        description,
      },
    });
  }
}
```

- [ ] **Step 7: DTO'lar, görünümler, presenter'lar**

`src/order-issues/dto/create-order-issue.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { IssueCategory, IssueResolution } from '../../trust/trust.enums';

export class CreateOrderIssueDto {
  @ApiProperty({ enum: IssueCategory })
  @IsEnum(IssueCategory)
  category: IssueCategory;

  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 1000)
  description: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 3,
    description: 'Yüklenmiş dosya id’leri',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds?: string[];

  @ApiProperty({ enum: IssueResolution })
  @IsEnum(IssueResolution)
  requestedResolution: IssueResolution;
}
```

`src/order-issues/dto/admin-order-issues.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../orders/dto/list-orders.dto';
import { IssueStatus } from '../../trust/trust.enums';

/** GET /admin/issues */
export class ListOrderIssuesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;
}

/** PATCH /admin/issues/:id */
export class ResolveOrderIssueDto {
  @ApiProperty({ enum: [IssueStatus.resolved, IssueStatus.rejected] })
  @IsIn([IssueStatus.resolved, IssueStatus.rejected])
  status: IssueStatus.resolved | IssueStatus.rejected;

  @ApiPropertyOptional({
    description: 'Yalnız resolved: kısmi/tam iade, kuruş',
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  refundKurus?: number;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 500,
    description: 'Müşteriye ve aşçıya görünür',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string | null;
}
```

`src/order-issues/views.ts` — dosyanın tamamı:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { FileType } from '../files/domain/file';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../trust/trust.enums';

/** `issue` of an order (customer and cook): the latest report, read-only. */
export class IssueSummaryView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: IssueCategory })
  category: IssueCategory;

  @ApiProperty({ enum: IssueResolution })
  requestedResolution: IssueResolution;

  @ApiProperty({ enum: IssueStatus })
  status: IssueStatus;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  refundKurus: number | null;

  @ApiProperty({ type: String, nullable: true })
  adminNote: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt: Date | null;
}

/** POST /orders/:id/issues */
export class IssueView extends IssueSummaryView {
  @ApiProperty({ type: String })
  description: string;

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];
}

export class IssueOrderView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, example: 'S-7K3F' })
  code: string;

  @ApiProperty({ type: String })
  kitchenId: string;

  @ApiProperty({ type: Number, description: 'kuruş' })
  totalKurus: number;
}

/** GET/PATCH /admin/issues */
export class AdminIssueView extends IssueView {
  @ApiProperty({ type: () => IssueOrderView })
  order: IssueOrderView;
}
```

`src/order-issues/presenters.ts` — dosyanın tamamı:

```ts
import { OrderIssue } from './domain/order-issue';
import { OrderIssueWithOrder } from './infrastructure/persistence/order-issue.repository';
import { AdminIssueView, IssueSummaryView, IssueView } from './views';

const summaryFields = (issue: OrderIssue) => ({
  id: issue.id,
  category: issue.category,
  requestedResolution: issue.requestedResolution,
  status: issue.status,
  refundKurus: issue.refundKurus,
  adminNote: issue.adminNote,
  createdAt: issue.createdAt,
  resolvedAt: issue.resolvedAt,
});

export const issueSummaryView = (issue: OrderIssue): IssueSummaryView =>
  Object.assign(new IssueSummaryView(), summaryFields(issue));

export const issueView = (issue: OrderIssue): IssueView =>
  Object.assign(new IssueView(), summaryFields(issue), {
    description: issue.description,
    photos: issue.photos,
  });

export const adminIssueView = ({
  issue,
  order,
}: OrderIssueWithOrder): AdminIssueView =>
  Object.assign(new AdminIssueView(), issueView(issue), { order });
```

Run: `npx tsc --noEmit -p tsconfig.json` → hata yok.

- [ ] **Step 8: Servis — test**

`src/order-issues/order-issue.fixture.ts` — dosyanın tamamı:

```ts
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../trust/trust.enums';
import { OrderIssue } from './domain/order-issue';

/** Unit-test fixture for the order-issue specs. */
export const anIssue = (overrides: Partial<OrderIssue> = {}): OrderIssue =>
  Object.assign(new OrderIssue(), {
    id: 'is1',
    orderId: 'o1',
    reporterId: 9,
    category: IssueCategory.missingItem,
    description: 'Sütlaç paketten çıkmadı',
    photos: [],
    requestedResolution: IssueResolution.refundPartial,
    status: IssueStatus.open,
    refundKurus: null,
    adminNote: null,
    resolvedAt: null,
    createdAt: new Date('2026-10-12T12:00:00Z'),
    updatedAt: new Date('2026-10-12T12:00:00Z'),
    ...overrides,
  });
```

`src/order-issues/order-issues.service.spec.ts` — dosyanın tamamı:

```ts
import {
  ConflictException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FilesService } from '../files/files.service';
import { MailService } from '../mail/mail.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { anOrder } from '../orders/order.fixture';
import { OrderStatus } from '../orders/order.enums';
import { PaymentsService } from '../payments/payments.service';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../trust/trust.enums';
import { OrderIssue } from './domain/order-issue';
import {
  DuplicateOpenIssueError,
  OrderIssueRepository,
} from './infrastructure/persistence/order-issue.repository';
import { anIssue } from './order-issue.fixture';
import { OrderIssuesService } from './order-issues.service';

const NOW = new Date('2026-10-13T10:00:00Z');
const completed = anOrder({
  status: OrderStatus.completed,
  completedAt: new Date('2026-10-12T10:00:00Z'),
});
const ORDER = { id: 'o1', code: 'S-7K3F', kitchenId: 'k1', totalKurus: 29400 };

const dto = {
  category: IssueCategory.missingItem,
  description: 'Sütlaç paketten çıkmadı',
  requestedResolution: IssueResolution.refundPartial,
};

const conflictKey = (error: unknown) =>
  ((error as ConflictException).getResponse() as { error: string }).error;

const build = (order: Order | null = completed) => {
  const issues = {
    create: jest
      .fn()
      .mockImplementation((data) => Promise.resolve(anIssue(data))),
    findById: jest.fn().mockResolvedValue(anIssue()),
    hasOpen: jest.fn().mockResolvedValue(false),
    list: jest.fn().mockResolvedValue([{ issue: anIssue(), order: ORDER }]),
    resolve: jest
      .fn()
      .mockImplementation(
        async (
          id: string,
          resolution: Partial<OrderIssue>,
          beforeClose: (issue: OrderIssue) => Promise<void>,
        ) => {
          await beforeClose(anIssue({ id }));
          return { issue: anIssue({ id, ...resolution }), order: ORDER };
        },
      ),
  };
  const orders = { findForCustomer: jest.fn().mockResolvedValue(order) };
  const payments = { refundPartial: jest.fn().mockResolvedValue({}) };
  const mail = { issueReported: jest.fn().mockResolvedValue(undefined) };
  const files = { findByIds: jest.fn().mockResolvedValue([]) };
  const config = {
    getOrThrow: (key: string) =>
      ({
        'trust.issueWindowHours': 48,
        'trust.supportEmail': 'destek@sofram.local',
      })[key],
  };

  const service = new OrderIssuesService(
    issues as unknown as OrderIssueRepository,
    orders as unknown as OrderRepository,
    payments as unknown as PaymentsService,
    mail as unknown as MailService,
    files as unknown as FilesService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, issues, payments, mail };
};

describe('OrderIssuesService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('should open a report and mail support', async () => {
      const { service, issues, mail } = build();

      const view = await service.create(9, 'o1', dto);

      expect(issues.create).toHaveBeenCalledWith({
        orderId: 'o1',
        reporterId: 9,
        photos: [],
        ...dto,
      });
      expect(mail.issueReported).toHaveBeenCalledWith({
        to: 'destek@sofram.local',
        data: {
          issueId: 'is1',
          orderCode: 'S-7K3F',
          category: 'missing_item',
          requestedResolution: 'refund_partial',
          description: 'Sütlaç paketten çıkmadı',
        },
      });
      expect(view).toMatchObject({ status: 'open', refundKurus: null });
    });

    it('should keep the report when the mail fails', async () => {
      const { service, mail } = build();
      mail.issueReported.mockRejectedValue(new Error('smtp down'));

      await expect(service.create(9, 'o1', dto)).resolves.toMatchObject({
        status: 'open',
      });
    });

    it('should 404 someone else’s order', async () => {
      const { service } = build(null);

      await expect(service.create(9, 'o1', dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should 409 issueNotAllowed while a report is open or after 48 hours', async () => {
      const open = build();
      open.issues.hasOpen.mockResolvedValue(true);
      expect(
        conflictKey(await open.service.create(9, 'o1', dto).catch((e) => e)),
      ).toBe('issueNotAllowed');

      const late = build(
        anOrder({
          status: OrderStatus.completed,
          completedAt: new Date('2026-10-11T09:00:00Z'),
        }),
      );
      expect(
        conflictKey(await late.service.create(9, 'o1', dto).catch((e) => e)),
      ).toBe('issueNotAllowed');
    });

    it('should turn a concurrent second report into issueNotAllowed', async () => {
      const { service, issues, mail } = build();
      issues.create.mockRejectedValue(new DuplicateOpenIssueError());

      expect(
        conflictKey(await service.create(9, 'o1', dto).catch((e) => e)),
      ).toBe('issueNotAllowed');
      expect(mail.issueReported).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('should refund part of the payment before closing', async () => {
      const { service, payments } = build();

      const view = await service.resolve('is1', {
        status: IssueStatus.resolved,
        refundKurus: 6500,
        adminNote: ' Sütlaç ücreti iade edildi ',
      });

      expect(payments.refundPartial).toHaveBeenCalledWith('o1', 6500);
      expect(view).toMatchObject({
        status: 'resolved',
        refundKurus: 6500,
        adminNote: 'Sütlaç ücreti iade edildi',
        order: { code: 'S-7K3F' },
      });
    });

    it('should reject without touching the payment', async () => {
      const { service, payments } = build();

      await expect(
        service.resolve('is1', { status: IssueStatus.rejected }),
      ).resolves.toMatchObject({ status: 'rejected', refundKurus: null });
      expect(payments.refundPartial).not.toHaveBeenCalled();
    });

    it('should 422 a refund on a rejection', async () => {
      const { service } = build();

      await expect(
        service.resolve('is1', {
          status: IssueStatus.rejected,
          refundKurus: 100,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should 409 issueClosed when it was already decided', async () => {
      const { service, issues } = build();
      issues.resolve.mockResolvedValue(null);

      expect(
        conflictKey(
          await service
            .resolve('is1', { status: IssueStatus.resolved })
            .catch((e) => e),
        ),
      ).toBe('issueClosed');
    });

    it('should 404 an unknown issue', async () => {
      const { service, issues } = build();
      issues.findById.mockResolvedValue(null);

      await expect(
        service.resolve('is9', { status: IssueStatus.rejected }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('should list with the status filter and the order', async () => {
    const { service, issues } = build();

    const page = await service.list({
      status: IssueStatus.open,
      page: 1,
      limit: 20,
    });

    expect(issues.list).toHaveBeenCalledWith(IssueStatus.open, {
      offset: 0,
      limit: 20,
    });
    expect(page.data[0]).toMatchObject({ id: 'is1', order: ORDER });
  });
});
```

Run: `npx jest src/order-issues` → FAIL (`Cannot find module './order-issues.service'`).

- [ ] **Step 9: Servis — kod**

Mail gönderilemezse kayıt yine 201 döner (loglanır). `rejected` + `refundKurus` 422; karara bağlanmış kayıt 409 `issueClosed`.

`src/order-issues/order-issues.service.ts` — dosyanın tamamı:

```ts
import {
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { FilesService } from '../files/files.service';
import { MailService } from '../mail/mail.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { PaymentsService } from '../payments/payments.service';
import { issueClosed, issueNotAllowed } from '../trust/trust-errors';
import { photosByIds } from '../trust/trust-photos';
import { canReportIssue } from '../trust/trust-rules';
import { IssueStatus } from '../trust/trust.enums';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { OrderIssue } from './domain/order-issue';
import {
  ListOrderIssuesQueryDto,
  ResolveOrderIssueDto,
} from './dto/admin-order-issues.dto';
import { CreateOrderIssueDto } from './dto/create-order-issue.dto';
import {
  DuplicateOpenIssueError,
  OrderIssueRepository,
} from './infrastructure/persistence/order-issue.repository';
import { adminIssueView, issueView } from './presenters';
import { AdminIssueView, IssueView } from './views';

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** "Sorun bildir": the customer reports, support is mailed, an admin decides. */
@Injectable()
export class OrderIssuesService {
  private readonly logger = new Logger(OrderIssuesService.name);

  constructor(
    private readonly issueRepository: OrderIssueRepository,
    private readonly orderRepository: OrderRepository,
    private readonly paymentsService: PaymentsService,
    private readonly mailService: MailService,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /** 409 issueNotAllowed outside the window or while a report is open. */
  async create(
    customerId: User['id'],
    orderId: Order['id'],
    dto: CreateOrderIssueDto,
  ): Promise<IssueView> {
    const order = await orNotFound(
      this.orderRepository.findForCustomer(customerId, orderId),
    );
    const windowHours = this.configService.getOrThrow(
      'trust.issueWindowHours',
      {
        infer: true,
      },
    );
    const hasOpen = await this.issueRepository.hasOpen(order.id);

    if (!canReportIssue(order, hasOpen, new Date(), windowHours)) {
      throw issueNotAllowed();
    }

    const photos = await photosByIds(this.filesService, dto.photoIds ?? []);
    let issue: OrderIssue;

    try {
      issue = await this.issueRepository.create({
        orderId: order.id,
        reporterId: customerId,
        category: dto.category,
        description: dto.description,
        photos,
        requestedResolution: dto.requestedResolution,
      });
    } catch (error) {
      if (error instanceof DuplicateOpenIssueError) {
        throw issueNotAllowed();
      }

      throw error;
    }

    await this.notifySupport(order, issue);
    return issueView(issue);
  }

  async list(
    query: ListOrderIssuesQueryDto,
  ): Promise<InfinityPaginationResponseDto<AdminIssueView>> {
    const issues = await this.issueRepository.list(query.status, {
      offset: (query.page - 1) * query.limit,
      limit: query.limit,
    });

    return infinityPagination(issues.map(adminIssueView), {
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * resolved (+ optional partial refund through PaymentsService) or rejected.
   * A closed issue is a 409 issueClosed; a refund beyond what is left is a
   * 422 refundKurus and the issue stays open.
   */
  async resolve(
    id: OrderIssue['id'],
    dto: ResolveOrderIssueDto,
  ): Promise<AdminIssueView> {
    if (dto.status === IssueStatus.rejected && dto.refundKurus !== undefined) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { refundKurus: 'onlyWhenResolved' },
      });
    }

    await orNotFound(this.issueRepository.findById(id));

    const resolved = await this.issueRepository.resolve(
      id,
      {
        status: dto.status,
        refundKurus: dto.refundKurus ?? null,
        adminNote: dto.adminNote?.trim() || null,
        resolvedAt: new Date(),
      },
      async (issue) => {
        if (dto.refundKurus !== undefined) {
          await this.paymentsService.refundPartial(
            issue.orderId,
            dto.refundKurus,
          );
        }
      },
    );

    if (!resolved) {
      throw issueClosed();
    }

    return adminIssueView(resolved);
  }

  /** Never fails the report: a mail that cannot be sent is logged. */
  private async notifySupport(order: Order, issue: OrderIssue): Promise<void> {
    try {
      await this.mailService.issueReported({
        to: this.configService.getOrThrow('trust.supportEmail', {
          infer: true,
        }),
        data: {
          issueId: issue.id,
          orderCode: order.code,
          category: issue.category,
          requestedResolution: issue.requestedResolution,
          description: issue.description,
        },
      });
    } catch (error) {
      this.logger.error(
        `Support mail failed for issue ${issue.id}: ${reasonOf(error)}`,
      );
    }
  }
}
```

Run: `npx jest src/order-issues` → PASS (11 test).

- [ ] **Step 10: Controller'lar ve modül**

`src/order-issues/order-issues.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { CreateOrderIssueDto } from './dto/create-order-issue.dto';
import { OrderIssuesService } from './order-issues.service';
import { IssueView } from './views';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'orders',
  version: '1',
})
export class OrderIssuesController {
  constructor(private readonly orderIssuesService: OrderIssuesService) {}

  @Post(':id/issues')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: IssueView })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOrderIssueDto,
  ): Promise<IssueView> {
    return this.orderIssuesService.create(request.user.id, id, dto);
  }
}
```

`src/order-issues/admin-order-issues.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import {
  ListOrderIssuesQueryDto,
  ResolveOrderIssueDto,
} from './dto/admin-order-issues.dto';
import { OrderIssuesService } from './order-issues.service';
import { AdminIssueView } from './views';

/** Swagger-only support desk (no admin panel). */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({
  path: 'admin/issues',
  version: '1',
})
export class AdminOrderIssuesController {
  constructor(private readonly orderIssuesService: OrderIssuesService) {}

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(AdminIssueView) })
  list(
    @Query() query: ListOrderIssuesQueryDto,
  ): Promise<InfinityPaginationResponseDto<AdminIssueView>> {
    return this.orderIssuesService.list(query);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: AdminIssueView })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveOrderIssueDto,
  ): Promise<AdminIssueView> {
    return this.orderIssuesService.resolve(id, dto);
  }
}
```

`src/order-issues/order-issues.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MailModule } from '../mail/mail.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminOrderIssuesController } from './admin-order-issues.controller';
import { RelationalOrderIssuePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderIssuesController } from './order-issues.controller';
import { OrderIssuesService } from './order-issues.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderIssuePersistenceModule,
    OrdersModule,
    PaymentsModule,
    MailModule,
    FilesModule,
  ],
  controllers: [OrderIssuesController, AdminOrderIssuesController],
  providers: [OrderIssuesService],
  exports: [RelationalOrderIssuePersistenceModule],
})
export class OrderIssuesModule {}
```

`src/app.module.ts` — şu bloğu:

```ts

import { FavoritesModule } from './favorites/favorites.module';

@Module({
  imports: [
    FavoritesModule,
    ReviewsModule,
    PaymentsModule,
```

şununla değiştir:

```ts

import { FavoritesModule } from './favorites/favorites.module';

import { OrderIssuesModule } from './order-issues/order-issues.module';

@Module({
  imports: [
    OrderIssuesModule,
    FavoritesModule,
    ReviewsModule,
    PaymentsModule,
```

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: temiz; dev API logunda `Mapped {/api/orders/:id/issues, POST}`, `{/api/admin/issues, GET}`, `{/api/admin/issues/:id, PATCH}`; `Duplicate DTO detected` uyarısı yok.

- [ ] **Step 11: e2e — sorun akışı**

maildev (1080) açık olmalı. İade sınırı `payment` satırı doğrudan okunarak doğrulanır.

`test/user/order-issues.e2e-spec.ts` — dosyanın tamamı:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL, MAIL_HOST, MAIL_PORT } from '../utils/constants';
import {
  Cart,
  addAddress,
  addProduct,
  adminLogin,
  categoryId,
  completeOrder,
  cookStep,
  northOf,
  openKitchen,
  phoneLogin,
  placeOrder,
  randomSpot,
  testDatabase,
  uniquePhone,
} from '../utils/orders';
import { MailMessage } from '../utils/types/mail-message.type';

describe('Order issues', () => {
  const app = APP_URL;
  const mail = `http://${MAIL_HOST}:${MAIL_PORT}`;
  const db = testDatabase();
  const HOME = randomSpot();
  let cook: string;
  let customer: string;
  let stranger: string;
  let admin: string;
  let pickup: Cart;
  let orderA: string;
  let issueA: string;
  let cancelledIssue: string;

  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token: string) =>
    request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const report = (orderId: string, overrides: Record<string, unknown> = {}) =>
    post(`/orders/${orderId}/issues`, customer).send({
      category: 'missing_item',
      description: 'Sütlaç paketten çıkmadı.',
      requestedResolution: 'refund_partial',
      ...overrides,
    });

  /** What the refunds wrote on the payment row. */
  const storedPayment = async (orderId: string) => {
    const [row] = await db.query(
      'SELECT "status", "amountKurus", "refundedKurus" FROM "payment" WHERE "orderId" = $1',
      [orderId],
    );
    return row as {
      status: string;
      amountKurus: number;
      refundedKurus: number;
    };
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90570'));
    customer = await phoneLogin(uniquePhone('+90571'));
    stranger = await phoneLogin(uniquePhone('+90572'));
    admin = await adminLogin();

    const kitchenId = await openKitchen(cook, HOME);
    const productId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    pickup = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId, quantity: 1 }],
    };
    orderA = await completeOrder(cook, customer, pickup);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('reporting', () => {
    it('should 422 a short description, an unknown category and too many photos', () =>
      report(orderA, {
        category: 'cold_food',
        description: ' kısa ',
        requestedResolution: 'money',
        photoIds: [1, 2, 3, 4],
      })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors.map((e: { field: string }) => e.field)).toEqual(
            expect.arrayContaining([
              'category',
              'description',
              'requestedResolution',
              'photoIds',
            ]),
          );
        }));

    it('should 404 someone else’s order', () =>
      post(`/orders/${orderA}/issues`, stranger)
        .send({
          category: 'late',
          description: 'Sipariş çok geç geldi.',
          requestedResolution: 'none',
        })
        .expect(404));

    it('should open a report on a completed order and mail support', async () => {
      const { body } = await report(orderA).expect(201);
      issueA = body.data.id;

      expect(body.data).toMatchObject({
        category: 'missing_item',
        description: 'Sütlaç paketten çıkmadı.',
        requestedResolution: 'refund_partial',
        status: 'open',
        refundKurus: null,
        adminNote: null,
        photos: [],
      });

      const { body: inbox } = await request(mail).get('/email').expect(200);
      const sent = (inbox as MailMessage[]).find(
        (message) =>
          message.to[0].address === process.env.SUPPORT_EMAIL &&
          message.text.includes(issueA),
      );
      expect(sent?.text).toContain('missing_item');
    });

    it('should refuse a second open report', () =>
      report(orderA)
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('issueNotAllowed');
        }));

    it('should refuse an order that is still being prepared', async () => {
      const order = await placeOrder(customer, pickup);
      await cookStep(cook, order.id, 'accept');

      await report(order.id).expect(409);

      await cookStep(cook, order.id, 'cancel', { reason: 'too_busy' });
      const { body } = await report(order.id, { category: 'other' }).expect(
        201,
      );
      cancelledIssue = body.data.id;
    });

    it('should accept a delivery stuck on the way for more than two hours', async () => {
      const addressId = await addAddress(customer, northOf(HOME, 1));
      const order = await placeOrder(customer, {
        ...pickup,
        fulfillment: 'delivery',
        addressId,
      });
      for (const action of ['accept', 'start', 'ready', 'dispatch']) {
        await cookStep(cook, order.id, action);
      }

      await report(order.id, { category: 'late' }).expect(409);

      await db.query(
        `UPDATE "order" SET "onTheWayAt" = now() - interval '3 hours' WHERE "id" = $1`,
        [order.id],
      );
      await report(order.id, { category: 'late' }).expect(201);
    });

    it('should close 48 hours after completion', async () => {
      const late = await completeOrder(cook, customer, pickup);
      await db.query(
        `UPDATE "order" SET "completedAt" = now() - interval '49 hours' WHERE "id" = $1`,
        [late],
      );

      await report(late).expect(409);
    });
  });

  describe('the admin', () => {
    it('should keep the desk to admins', async () => {
      await get('/admin/issues', customer).expect(403);
      await patch(`/admin/issues/${issueA}`, cook)
        .send({ status: 'rejected' })
        .expect(403);
    });

    it('should list open reports with their order', () =>
      get('/admin/issues?status=open&limit=50', admin)
        .expect(200)
        .expect(({ body }) => {
          const issue = body.data.data.find(
            (i: { id: string }) => i.id === issueA,
          );
          expect(issue).toMatchObject({
            status: 'open',
            order: { id: orderA, totalKurus: 14700 },
          });
          expect(issue.order.code).toMatch(/^S-/);
        }));

    it('should 422 a refund on a rejection and a non-positive refund', async () => {
      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'rejected', refundKurus: 100 })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'refundKurus', message: 'onlyWhenResolved' },
          ]);
        });

      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'resolved', refundKurus: 0 })
        .expect(422);
    });

    it('should resolve with a partial refund that stays paid', async () => {
      await patch(`/admin/issues/${issueA}`, admin)
        .send({
          status: 'resolved',
          refundKurus: 5000,
          adminNote: 'Sütlaç ücreti iade edildi',
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'resolved',
            refundKurus: 5000,
            adminNote: 'Sütlaç ücreti iade edildi',
          });
          expect(body.data.resolvedAt).toEqual(expect.any(String));
        });

      expect(await storedPayment(orderA)).toEqual({
        status: 'paid',
        amountKurus: 14700,
        refundedKurus: 5000,
      });

      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'rejected' })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('issueClosed');
        });
    });

    it('should cap the refunds at what was paid and keep the report open', async () => {
      const { body } = await report(orderA, {
        category: 'quality_hygiene',
        requestedResolution: 'refund_full',
      }).expect(201);

      await patch(`/admin/issues/${body.data.id}`, admin)
        .send({ status: 'resolved', refundKurus: 9701 })
        .expect(422)
        .expect(({ body: error }) => {
          expect(error.errors).toEqual([
            { field: 'refundKurus', message: 'exceedsPaid' },
          ]);
        });

      expect((await storedPayment(orderA)).refundedKurus).toBe(5000);

      await patch(`/admin/issues/${body.data.id}`, admin)
        .send({ status: 'resolved', refundKurus: 9700 })
        .expect(200);

      expect(await storedPayment(orderA)).toEqual({
        status: 'refunded',
        amountKurus: 14700,
        refundedKurus: 14700,
      });
    });

    it('should 422 any refund on an order that was refunded in full', async () => {
      await patch(`/admin/issues/${cancelledIssue}`, admin)
        .send({ status: 'resolved', refundKurus: 100 })
        .expect(422);

      await patch(`/admin/issues/${cancelledIssue}`, admin)
        .send({ status: 'resolved', adminNote: 'Ödeme zaten iade edildi' })
        .expect(200);
    });
  });
});
```

Run: `npm run test:e2e -- --runInBand test/user/order-issues.e2e-spec.ts`
Expected: PASS (13 test). <http://localhost:1080>'de `Sorun bildirimi · S-…` konulu mail `SUPPORT_EMAIL` adresine görünür.

- [ ] **Step 12: Tüm paket ve commit**

Run: `npm run lint && npm test && npm run test:e2e -- --runInBand` → temiz, PASS.

```bash
git add src/payments src/order-issues src/mail src/app.module.ts test/user/order-issues.e2e-spec.ts
git commit -m "feat(order-issues): report order issues, mail support and resolve with partial refunds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sipariş mesajlaşması ve sipariş ekranlarına güven alanları

**Files:**
- Modify: `src/orders/infrastructure/persistence/order.repository.ts`, `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts` (`markRead`)
- Modify: `src/reviews/infrastructure/persistence/review.repository.ts`, `src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts` (`countUnreplied`)
- Modify: `src/order-issues/infrastructure/persistence/order-issue.repository.ts`, `src/order-issues/infrastructure/persistence/relational/repositories/order-issue.repository.ts` (`latestForOrder`)
- Create: `src/order-messages/infrastructure/persistence/order-message.repository.ts`, `src/order-messages/infrastructure/persistence/relational/repositories/order-message.repository.ts`, `src/order-messages/infrastructure/persistence/relational/relational-persistence.module.ts`, `src/order-messages/dto/order-messages.dto.ts`, `src/order-messages/views.ts`, `src/order-messages/order-messages.service.ts`, `src/order-messages/order-messages.controller.ts`, `src/order-messages/cook-order-messages.controller.ts`, `src/order-messages/order-messages.module.ts`
- Test: `src/order-messages/order-messages.service.spec.ts`
- Create: `src/orders/order-trust.service.ts`; Test: `src/orders/order-trust.service.spec.ts`
- Modify: `src/orders/views.ts`, `src/orders/presenters.ts`, `src/orders/presenters.spec.ts`, `src/orders/orders.service.ts`, `src/orders/orders.service.spec.ts`, `src/orders/cook-orders.service.ts`, `src/orders/cook-orders.service.spec.ts`, `src/orders/orders.module.ts`, `src/app.module.ts`
- Test: `test/user/order-messages.e2e-spec.ts`; Modify: `test/user/orders.e2e-spec.ts` (özet beklentisi)

**Interfaces:**
- Consumes: Task 1 (`canMessage`, `canReview`, `canReportIssue`, `unreadRule`, `ReadMarker`, `messagingClosed`, `MessageSide`, `IssueStatus`, `TrustConfig`), Task 2 (`OrderMessage`, `NewOrderMessage`, `OrderMessageEntity`, `OrderMessageMapper`, `Order.customerLastReadAt/cookLastReadAt`), Task 3 (`ReviewRepository.findByOrderIds`, `RelationalReviewPersistenceModule`, `orderReviewView`, `OrderReviewView`, `aReview`), Task 5 (`OrderIssueRepository`, `RelationalOrderIssuePersistenceModule`, `issueSummaryView`, `IssueSummaryView`, `anIssue`), `KitchensService.findMine`.
- Produces:
  - `OrderRepository.markRead(id: Order['id'], marker: ReadMarker, at: Date): Promise<void>`; `ReviewRepository.countUnreplied(kitchenId): Promise<number>`; `OrderIssueRepository.latestForOrder(orderId): Promise<OrderIssue | null>`.
  - `OrderMessageRepository` (port): `create(message: NewOrderMessage): Promise<OrderMessage>`, `list(orderId, after: Date | null, limit: number): Promise<OrderMessage[]>` (en eski üstte), `countUnread(orderIds: string[], viewer: MessageSide): Promise<Map<string, number>>`, `countUnreadForKitchen(kitchenId): Promise<number>`.
  - `OrderMessagesService`: `readAsCustomer(customerId, orderId, after: string | undefined): Promise<OrderMessagesView>`, `sendAsCustomer(customerId, orderId, body): Promise<OrderMessageView>`, `readAsCook(ownerId, orderId, after)`, `sendAsCook(ownerId, orderId, body)`; `MESSAGE_PAGE = 100`. Görünümler `OrderMessageView { id, senderRole, body, createdAt }`, `OrderMessagesView { data, canMessage }`. `OrderMessagesModule` `OrderMessagesService`'i dışa açar.
  - Uçlar: `GET /orders/:id/messages?after`, `POST /orders/:id/messages { body }` (201), `GET /kitchens/me/orders/:id/messages?after`, `POST /kitchens/me/orders/:id/messages` (201).
  - `OrderTrustService`: `forCustomer(order, now?): Promise<CustomerOrderTrust>`, `forCustomerCards(orders, now?): Promise<Map<string, CustomerCardTrust>>`, `forCook(order, now?): Promise<CookOrderTrust>`, `cookUnread(orders): Promise<Map<string, number>>`, `cookSummary(kitchen): Promise<CookSummaryTrust>`; tipler `CustomerOrderTrust = { review: Review | null; canReview; issue: OrderIssue | null; canReportIssue; unreadMessages; canMessage }`, `CustomerCardTrust = Pick<…, 'unreadMessages' | 'canReview'>`, `CookOrderTrust = Pick<…, 'review' | 'issue' | 'unreadMessages' | 'canMessage'>`, `CookSummaryTrust = { rating: { avg; count }; unrepliedReviews; unreadMessages }`.
  - Presenter imzaları: `customerOrderCard(order, trust: CustomerCardTrust)`, `customerOrderDetail(order, paymentStatus, deliveryBufferMinutes, trust: CustomerOrderTrust)`, `cookOrderCard(order, unreadMessages: number)`, `cookOrderDetail(order, trust: CookOrderTrust)`.
  - Yanıt alanları: `CustomerOrderCard` + `unreadMessages`, `canReview`; `CustomerOrderDetail` + `review`, `canReview`, `issue`, `canReportIssue`, `unreadMessages`, `canMessage`; `CookOrderCard` + `unreadMessages`; `CookOrderDetail` + `review`, `issue`, `unreadMessages`, `canMessage`; `CookOrderSummary` + `rating { avg, count }`, `unrepliedReviews`, `unreadMessages`.

- [ ] **Step 1: Okuma işareti ve yardımcı sorgular**

Okuma işareti `customerLastReadAt`/`cookLastReadAt`; hangisinin yazılacağını `unreadRule(side).readMarker` söyler.

`src/orders/infrastructure/persistence/order.repository.ts` — dosyanın başındaki şu bloğu:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../payments/domain/payment';
import { User } from '../../../users/domain/user';
import { NullableType } from '../../../utils/types/nullable.type';
import { NewOrder, Order, OrderPatch } from '../../domain/order';
```

şununla değiştir:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../payments/domain/payment';
import { ReadMarker } from '../../../trust/trust-rules';
import { User } from '../../../users/domain/user';
import { NullableType } from '../../../utils/types/nullable.type';
import { NewOrder, Order, OrderPatch } from '../../domain/order';
```

`src/orders/infrastructure/persistence/order.repository.ts` — ardından dosyanın sonundaki şu bloğu:

```ts

  /** Account deletion (KVKK): the copies of the customer's addresses go. */
  abstract clearDeliveryAddresses(customerId: User['id']): Promise<void>;
}
```

şununla değiştir:

```ts

  /** Account deletion (KVKK): the copies of the customer's addresses go. */
  abstract clearDeliveryAddresses(customerId: User['id']): Promise<void>;

  /** A side opened the chat: its messages up to `at` count as read. */
  abstract markRead(
    id: Order['id'],
    marker: ReadMarker,
    at: Date,
  ): Promise<void>;
}
```

`src/orders/infrastructure/persistence/relational/repositories/order.repository.ts` — şu bloğu:

```ts
  Repository,
} from 'typeorm';
import { SaleType } from '../../../../../catalog/catalog.enums';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../../../payments/domain/payment';
import { PaymentEntity } from '../../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
```

şununla değiştir:

```ts
  Repository,
} from 'typeorm';
import { SaleType } from '../../../../../catalog/catalog.enums';
import { ReadMarker } from '../../../../../trust/trust-rules';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { NewPayment } from '../../../../../payments/domain/payment';
import { PaymentEntity } from '../../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
```

`src/orders/infrastructure/persistence/relational/repositories/order.repository.ts` — ardından şu bloğu:

```ts
      .execute();
  }

  /** ON CONFLICT DO NOTHING + retry: a code collision never aborts the transaction. */
  private async insertWithFreshCode(
    manager: EntityManager,
```

şununla değiştir:

```ts
      .execute();
  }

  async markRead(id: Order['id'], marker: ReadMarker, at: Date): Promise<void> {
    await this.orders.update({ id }, { [marker]: at });
  }

  /** ON CONFLICT DO NOTHING + retry: a code collision never aborts the transaction. */
  private async insertWithFreshCode(
    manager: EntityManager,
```

`src/reviews/infrastructure/persistence/review.repository.ts` — şu bloğu:

```ts
    page: ReviewPage,
  ): Promise<Review[]>;

  /** Every review of the kitchen grouped by star, visibility and deletion. */
  abstract ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]>;

```

şununla değiştir:

```ts
    page: ReviewPage,
  ): Promise<Review[]>;

  /** Live reviews of the kitchen without a reply (hidden ones included, like the cook's list). */
  abstract countUnreplied(kitchenId: Kitchen['id']): Promise<number>;

  /** Every review of the kitchen grouped by star, visibility and deletion. */
  abstract ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]>;

```

`src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts` — şu bloğu:

```ts
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]> {
    return ratingGroupsOf(this.reviews.manager, kitchenId);
  }
```

şununla değiştir:

```ts
    return entities.map((entity) => ReviewMapper.toDomain(entity));
  }

  countUnreplied(kitchenId: Kitchen['id']): Promise<number> {
    return this.reviews.count({ where: { kitchenId, reply: IsNull() } });
  }

  ratingGroups(kitchenId: Kitchen['id']): Promise<RatingGroup[]> {
    return ratingGroupsOf(this.reviews.manager, kitchenId);
  }
```

`src/order-issues/infrastructure/persistence/order-issue.repository.ts` — şu bloğu:

```ts

  abstract hasOpen(orderId: Order['id']): Promise<boolean>;

  /** Newest first; every status when `status` is undefined. */
  abstract list(
    status: IssueStatus | undefined,
```

şununla değiştir:

```ts

  abstract hasOpen(orderId: Order['id']): Promise<boolean>;

  /** The newest report of the order — the open one, if any (only one can be). */
  abstract latestForOrder(
    orderId: Order['id'],
  ): Promise<NullableType<OrderIssue>>;

  /** Newest first; every status when `status` is undefined. */
  abstract list(
    status: IssueStatus | undefined,
```

`src/order-issues/infrastructure/persistence/relational/repositories/order-issue.repository.ts` — şu bloğu:

```ts
    return this.issues.exists({ where: { orderId, status: IssueStatus.open } });
  }

  async list(
    status: IssueStatus | undefined,
    page: IssuePage,
```

şununla değiştir:

```ts
    return this.issues.exists({ where: { orderId, status: IssueStatus.open } });
  }

  async latestForOrder(
    orderId: OrderIssue['orderId'],
  ): Promise<NullableType<OrderIssue>> {
    const entity = await this.issues.findOne({
      where: { orderId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return entity ? OrderIssueMapper.toDomain(entity) : null;
  }

  async list(
    status: IssueStatus | undefined,
    page: IssuePage,
```

Run: `npx tsc --noEmit -p tsconfig.json` → hata yok.

- [ ] **Step 2: Mesaj repository'si**

Okunmamış sayısı `unreadRule()`'un SQL karşılığıdır: karşı tarafın, okuyanın işaretinden sonra yazdığı mesajlar (işaret yoksa hepsi). Sipariş sayfası tek sorguyla sayılır.

`src/order-messages/infrastructure/persistence/order-message.repository.ts` — dosyanın tamamı:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { Order } from '../../../orders/domain/order';
import { MessageSide } from '../../../trust/trust.enums';
import { NewOrderMessage, OrderMessage } from '../../domain/order-message';

export abstract class OrderMessageRepository {
  abstract create(message: NewOrderMessage): Promise<OrderMessage>;

  /** Oldest first; only those written after `after` when given. */
  abstract list(
    orderId: Order['id'],
    after: Date | null,
    limit: number,
  ): Promise<OrderMessage[]>;

  /** Unread per order for `viewer` (unreadRule); orders without any are left out. */
  abstract countUnread(
    orderIds: Order['id'][],
    viewer: MessageSide,
  ): Promise<Map<Order['id'], number>>;

  /** Customers' messages the cook has not read, over every order of the kitchen. */
  abstract countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number>;
}
```

`src/order-messages/infrastructure/persistence/relational/repositories/order-message.repository.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { Order } from '../../../../../orders/domain/order';
import { unreadRule } from '../../../../../trust/trust-rules';
import { MessageSide } from '../../../../../trust/trust.enums';
import {
  NewOrderMessage,
  OrderMessage,
} from '../../../../domain/order-message';
import { OrderMessageRepository } from '../../order-message.repository';
import { OrderMessageEntity } from '../entities/order-message.entity';
import { OrderMessageMapper } from '../mappers/order-message.mapper';

/** unreadRule() in SQL, for message alias `m` and order alias `o`. */
const unreadFor = (viewer: MessageSide) => {
  const { senderRole, readMarker } = unreadRule(viewer);

  return {
    condition:
      `m."senderRole" = :senderRole ` +
      `AND (o."${readMarker}" IS NULL OR m."createdAt" > o."${readMarker}")`,
    senderRole,
  };
};

@Injectable()
export class OrderMessageRelationalRepository implements OrderMessageRepository {
  constructor(
    @InjectRepository(OrderMessageEntity)
    private readonly messages: Repository<OrderMessageEntity>,
  ) {}

  async create(message: NewOrderMessage): Promise<OrderMessage> {
    const entity = await this.messages.save(
      this.messages.create(OrderMessageMapper.toPersistence(message)),
    );
    return OrderMessageMapper.toDomain(entity);
  }

  async list(
    orderId: Order['id'],
    after: Date | null,
    limit: number,
  ): Promise<OrderMessage[]> {
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m."orderId" = :orderId', { orderId });

    if (after) {
      qb.andWhere('m."createdAt" > :after', { after });
    }

    const entities = await qb
      .orderBy('m.createdAt', 'ASC')
      .addOrderBy('m.id', 'ASC')
      .limit(limit)
      .getMany();
    return entities.map((entity) => OrderMessageMapper.toDomain(entity));
  }

  async countUnread(
    orderIds: Order['id'][],
    viewer: MessageSide,
  ): Promise<Map<Order['id'], number>> {
    if (orderIds.length === 0) {
      return new Map();
    }

    const { condition, senderRole } = unreadFor(viewer);
    const rows = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.order', 'o')
      .select('m."orderId"', 'orderId')
      .addSelect('COUNT(*)', 'count')
      .where('m."orderId" IN (:...orderIds)', { orderIds })
      .andWhere(condition, { senderRole })
      .groupBy('m."orderId"')
      .getRawMany<{ orderId: string; count: string }>();

    return new Map(rows.map((row) => [row.orderId, Number(row.count)]));
  }

  async countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number> {
    const { condition, senderRole } = unreadFor(MessageSide.cook);
    const row = await this.messages
      .createQueryBuilder('m')
      .innerJoin('m.order', 'o')
      .select('COUNT(*)', 'count')
      .where('o."kitchenId" = :kitchenId', { kitchenId })
      .andWhere(condition, { senderRole })
      .getRawOne<{ count: string }>();

    return Number(row?.count ?? 0);
  }
}
```

`src/order-messages/infrastructure/persistence/relational/relational-persistence.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderMessageRepository } from '../order-message.repository';
import { OrderMessageEntity } from './entities/order-message.entity';
import { OrderMessageRelationalRepository } from './repositories/order-message.repository';

@Module({
  imports: [TypeOrmModule.forFeature([OrderMessageEntity])],
  providers: [
    {
      provide: OrderMessageRepository,
      useClass: OrderMessageRelationalRepository,
    },
  ],
  exports: [OrderMessageRepository],
})
export class RelationalOrderMessagePersistenceModule {}
```

- [ ] **Step 3: DTO ve görünümler**

`src/order-messages/dto/order-messages.dto.ts` — dosyanın tamamı:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** GET …/messages?after= — the createdAt of the last message the client has. */
export class ListOrderMessagesQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Yalnız bundan sonra yazılanlar',
  })
  @IsOptional()
  @IsISO8601()
  after?: string;
}

/** POST …/messages */
export class SendOrderMessageDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;
}
```

`src/order-messages/views.ts` — dosyanın tamamı:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { MessageSide } from '../trust/trust.enums';

export class OrderMessageView {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ enum: MessageSide })
  senderRole: MessageSide;

  @ApiProperty({ type: String })
  body: string;

  @ApiProperty({ description: 'Sonraki sorgunun `after` değeri' })
  createdAt: Date;
}

/** GET …/messages — oldest first, at most 100. */
export class OrderMessagesView {
  @ApiProperty({ type: () => OrderMessageView, isArray: true })
  data: OrderMessageView[];

  @ApiProperty({
    type: Boolean,
    description: 'false: sohbet salt okunur ("Bu sohbet kapandı")',
  })
  canMessage: boolean;
}
```

- [ ] **Step 4: Mesaj servisi — test**

`src/order-messages/order-messages.service.spec.ts` — dosyanın tamamı:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { anOrder } from '../orders/order.fixture';
import { OrderStatus } from '../orders/order.enums';
import { MessageSide } from '../trust/trust.enums';
import { OrderMessageRepository } from './infrastructure/persistence/order-message.repository';
import { MESSAGE_PAGE, OrderMessagesService } from './order-messages.service';

const NOW = new Date('2026-10-13T10:00:00Z');
const message = {
  id: 'm1',
  orderId: 'o1',
  senderId: 7,
  senderRole: MessageSide.cook,
  body: 'Yoldayım',
  createdAt: new Date('2026-10-13T09:59:00Z'),
};

const build = (
  order: Order | null = anOrder({ status: OrderStatus.ready }),
) => {
  const messages = {
    create: jest
      .fn()
      .mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'm2', createdAt: NOW }),
      ),
    list: jest.fn().mockResolvedValue([message]),
  };
  const orders = {
    findForCustomer: jest.fn().mockResolvedValue(order),
    findForKitchen: jest.fn().mockResolvedValue(order),
    markRead: jest.fn().mockResolvedValue(undefined),
  };
  const kitchens = {
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'trust.messagingWindowHours': 24 })[key],
  };

  const service = new OrderMessagesService(
    messages as unknown as OrderMessageRepository,
    orders as unknown as OrderRepository,
    kitchens as unknown as KitchensService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, messages, orders, kitchens };
};

describe('OrderMessagesService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should mark the customer’s side read, then return the newer messages', async () => {
    const { service, messages, orders } = build();

    const view = await service.readAsCustomer(
      9,
      'o1',
      '2026-10-13T09:00:00.000Z',
    );

    expect(orders.markRead).toHaveBeenCalledWith(
      'o1',
      'customerLastReadAt',
      NOW,
    );
    expect(messages.list).toHaveBeenCalledWith(
      'o1',
      new Date('2026-10-13T09:00:00.000Z'),
      MESSAGE_PAGE,
    );
    expect(view).toEqual({
      data: [
        {
          id: 'm1',
          senderRole: 'cook',
          body: 'Yoldayım',
          createdAt: message.createdAt,
        },
      ],
      canMessage: true,
    });
    expect(view.data[0]).not.toHaveProperty('senderId');
  });

  it('should read from the start without `after` and mark the cook’s side', async () => {
    const { service, messages, orders, kitchens } = build();

    await service.readAsCook(7, 'o1', undefined);

    expect(kitchens.findMine).toHaveBeenCalledWith(7);
    expect(orders.findForKitchen).toHaveBeenCalledWith('k1', 'o1');
    expect(orders.markRead).toHaveBeenCalledWith('o1', 'cookLastReadAt', NOW);
    expect(messages.list).toHaveBeenCalledWith('o1', null, MESSAGE_PAGE);
  });

  it('should send with the sender’s side', async () => {
    const { service, messages } = build();

    await service.sendAsCustomer(9, 'o1', 'Kapıdayım');
    await service.sendAsCook(7, 'o1', 'Geliyorum');

    expect(messages.create).toHaveBeenNthCalledWith(1, {
      orderId: 'o1',
      senderId: 9,
      senderRole: MessageSide.customer,
      body: 'Kapıdayım',
    });
    expect(messages.create).toHaveBeenNthCalledWith(2, {
      orderId: 'o1',
      senderId: 7,
      senderRole: MessageSide.cook,
      body: 'Geliyorum',
    });
  });

  it('should go read-only 24 hours after the order closed', async () => {
    const closed = anOrder({
      status: OrderStatus.completed,
      completedAt: new Date('2026-10-12T09:59:00Z'),
    });
    const { service, messages } = build(closed);

    const error = await service
      .sendAsCustomer(9, 'o1', 'Merhaba')
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      status: 409,
      error: 'messagingClosed',
    });
    expect(messages.create).not.toHaveBeenCalled();
    await expect(
      service.readAsCustomer(9, 'o1', undefined),
    ).resolves.toMatchObject({ canMessage: false });
  });

  it('should 404 anyone outside the order', async () => {
    const { service, messages } = build(null);

    await expect(
      service.readAsCustomer(10, 'o1', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.sendAsCook(8, 'o1', 'Hey')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(messages.list).not.toHaveBeenCalled();
  });
});
```

Run: `npx jest src/order-messages` → FAIL (modül yok).

- [ ] **Step 5: Mesaj servisi — kod**

Okumada önce `now` alınır ve işaret yazılır, sonra mesajlar okunur: arada gelen bir mesaj okunmuş sayılmaz (bir sonraki sorguda okunmamış görünür, `after` ile de gelir). Gönderim işareti değiştirmez.

`src/order-messages/order-messages.service.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { messagingClosed } from '../trust/trust-errors';
import { canMessage, unreadRule } from '../trust/trust-rules';
import { MessageSide } from '../trust/trust.enums';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { OrderMessage } from './domain/order-message';
import { OrderMessageRepository } from './infrastructure/persistence/order-message.repository';
import { OrderMessageView, OrderMessagesView } from './views';

/** One poll returns at most this many messages. */
export const MESSAGE_PAGE = 100;

const messageView = (message: OrderMessage): OrderMessageView =>
  Object.assign(new OrderMessageView(), {
    id: message.id,
    senderRole: message.senderRole,
    body: message.body,
    createdAt: message.createdAt,
  });

/**
 * The order chat. The order decides who may take part: its customer, and the
 * cook of its kitchen — anyone else gets a 404. Never a phone number.
 */
@Injectable()
export class OrderMessagesService {
  constructor(
    private readonly messageRepository: OrderMessageRepository,
    private readonly orderRepository: OrderRepository,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async readAsCustomer(
    customerId: User['id'],
    orderId: Order['id'],
    after: string | undefined,
  ): Promise<OrderMessagesView> {
    const order = await this.customerOrder(customerId, orderId);
    return this.read(order, MessageSide.customer, after);
  }

  async sendAsCustomer(
    customerId: User['id'],
    orderId: Order['id'],
    body: string,
  ): Promise<OrderMessageView> {
    const order = await this.customerOrder(customerId, orderId);
    return this.send(order, customerId, MessageSide.customer, body);
  }

  async readAsCook(
    ownerId: User['id'],
    orderId: Order['id'],
    after: string | undefined,
  ): Promise<OrderMessagesView> {
    const order = await this.cookOrder(ownerId, orderId);
    return this.read(order, MessageSide.cook, after);
  }

  async sendAsCook(
    ownerId: User['id'],
    orderId: Order['id'],
    body: string,
  ): Promise<OrderMessageView> {
    const order = await this.cookOrder(ownerId, orderId);
    return this.send(order, ownerId, MessageSide.cook, body);
  }

  /** Moves the reader's marker to now, then returns the messages. */
  private async read(
    order: Order,
    side: MessageSide,
    after: string | undefined,
  ): Promise<OrderMessagesView> {
    const now = new Date();
    await this.orderRepository.markRead(
      order.id,
      unreadRule(side).readMarker,
      now,
    );
    const messages = await this.messageRepository.list(
      order.id,
      after ? new Date(after) : null,
      MESSAGE_PAGE,
    );

    return Object.assign(new OrderMessagesView(), {
      data: messages.map(messageView),
      canMessage: canMessage(order, now, this.windowHours()),
    });
  }

  /** 409 messagingClosed once the window after closing is over. */
  private async send(
    order: Order,
    senderId: User['id'],
    side: MessageSide,
    body: string,
  ): Promise<OrderMessageView> {
    if (!canMessage(order, new Date(), this.windowHours())) {
      throw messagingClosed();
    }

    return messageView(
      await this.messageRepository.create({
        orderId: order.id,
        senderId,
        senderRole: side,
        body,
      }),
    );
  }

  private customerOrder(
    customerId: User['id'],
    orderId: Order['id'],
  ): Promise<Order> {
    return orNotFound(
      this.orderRepository.findForCustomer(customerId, orderId),
    );
  }

  private async cookOrder(
    ownerId: User['id'],
    orderId: Order['id'],
  ): Promise<Order> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return orNotFound(this.orderRepository.findForKitchen(kitchen.id, orderId));
  }

  private windowHours(): number {
    return this.configService.getOrThrow('trust.messagingWindowHours', {
      infer: true,
    });
  }
}
```

Run: `npx jest src/order-messages` → PASS (5 test).

- [ ] **Step 6: Mesaj controller'ları ve modül**

`src/order-messages/order-messages.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Get,
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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import {
  ListOrderMessagesQueryDto,
  SendOrderMessageDto,
} from './dto/order-messages.dto';
import { OrderMessagesService } from './order-messages.service';
import { OrderMessageView, OrderMessagesView } from './views';

/** The customer's side of the order chat. */
@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'orders',
  version: '1',
})
export class OrderMessagesController {
  constructor(private readonly orderMessagesService: OrderMessagesService) {}

  @Get(':id/messages')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: OrderMessagesView })
  read(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListOrderMessagesQueryDto,
  ): Promise<OrderMessagesView> {
    return this.orderMessagesService.readAsCustomer(
      request.user.id,
      id,
      query.after,
    );
  }

  @Post(':id/messages')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: OrderMessageView })
  send(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendOrderMessageDto,
  ): Promise<OrderMessageView> {
    return this.orderMessagesService.sendAsCustomer(
      request.user.id,
      id,
      dto.body,
    );
  }
}
```

`src/order-messages/cook-order-messages.controller.ts` — dosyanın tamamı:

```ts
import {
  Body,
  Controller,
  Get,
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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import {
  ListOrderMessagesQueryDto,
  SendOrderMessageDto,
} from './dto/order-messages.dto';
import { OrderMessagesService } from './order-messages.service';
import { OrderMessageView, OrderMessagesView } from './views';

/** The cook's side of the order chat; no kitchen → 404. */
@ApiTags('Kitchen orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/orders',
  version: '1',
})
export class CookOrderMessagesController {
  constructor(private readonly orderMessagesService: OrderMessagesService) {}

  @Get(':id/messages')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: OrderMessagesView })
  read(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListOrderMessagesQueryDto,
  ): Promise<OrderMessagesView> {
    return this.orderMessagesService.readAsCook(
      request.user.id,
      id,
      query.after,
    );
  }

  @Post(':id/messages')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: OrderMessageView })
  send(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendOrderMessageDto,
  ): Promise<OrderMessageView> {
    return this.orderMessagesService.sendAsCook(request.user.id, id, dto.body);
  }
}
```

`src/order-messages/order-messages.module.ts` — dosyanın tamamı:

```ts
import {
  // do not remove this comment
  Module,
} from '@nestjs/common';
import { KitchensModule } from '../kitchens/kitchens.module';
import { OrdersModule } from '../orders/orders.module';
import { CookOrderMessagesController } from './cook-order-messages.controller';
import { RelationalOrderMessagePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderMessagesController } from './order-messages.controller';
import { OrderMessagesService } from './order-messages.service';

@Module({
  imports: [
    // do not remove this comment
    RelationalOrderMessagePersistenceModule,
    OrdersModule,
    KitchensModule,
  ],
  controllers: [OrderMessagesController, CookOrderMessagesController],
  providers: [OrderMessagesService],
  exports: [OrderMessagesService],
})
export class OrderMessagesModule {}
```

`src/app.module.ts` — şu bloğu:

```ts

import { OrderIssuesModule } from './order-issues/order-issues.module';

@Module({
  imports: [
    OrderIssuesModule,
    FavoritesModule,
    ReviewsModule,
```

şununla değiştir:

```ts

import { OrderIssuesModule } from './order-issues/order-issues.module';

import { OrderMessagesModule } from './order-messages/order-messages.module';

@Module({
  imports: [
    OrderMessagesModule,
    OrderIssuesModule,
    FavoritesModule,
    ReviewsModule,
```

Run: `npx tsc --noEmit -p tsconfig.json` → hata yok.

- [ ] **Step 7: Sipariş ekranı güven alanları — test**

`src/orders/order-trust.service.spec.ts` — dosyanın tamamı:

```ts
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { OrderIssueRepository } from '../order-issues/infrastructure/persistence/order-issue.repository';
import { anIssue } from '../order-issues/order-issue.fixture';
import { OrderMessageRepository } from '../order-messages/infrastructure/persistence/order-message.repository';
import { ReviewRepository } from '../reviews/infrastructure/persistence/review.repository';
import { aReview } from '../reviews/review.fixture';
import { IssueStatus, MessageSide } from '../trust/trust.enums';
import { OrderTrustService } from './order-trust.service';
import { anOrder } from './order.fixture';
import { OrderStatus } from './order.enums';

const NOW = new Date('2026-10-13T10:00:00Z');
// Completed two hours ago: every window is still open.
const completed = anOrder({
  status: OrderStatus.completed,
  completedAt: new Date('2026-10-13T08:00:00Z'),
});

const build = () => {
  const reviews = {
    findByOrderIds: jest.fn().mockResolvedValue([]),
    countUnreplied: jest.fn().mockResolvedValue(3),
  };
  const issues = { latestForOrder: jest.fn().mockResolvedValue(null) };
  const messages = {
    countUnread: jest.fn().mockResolvedValue(new Map([['o1', 2]])),
    countUnreadForKitchen: jest.fn().mockResolvedValue(5),
  };
  const config = {
    getOrThrow: (key: string) =>
      ({
        trust: {
          reviewWindowDays: 7,
          issueWindowHours: 48,
          messagingWindowHours: 24,
          supportEmail: 'destek@sofram.local',
        },
      })[key],
  };

  const service = new OrderTrustService(
    reviews as unknown as ReviewRepository,
    issues as unknown as OrderIssueRepository,
    messages as unknown as OrderMessageRepository,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, reviews, issues, messages };
};

describe('OrderTrustService', () => {
  it('should open review, issue and chat on a fresh completed order', async () => {
    const { service, messages } = build();

    await expect(service.forCustomer(completed, NOW)).resolves.toEqual({
      review: null,
      canReview: true,
      issue: null,
      canReportIssue: true,
      unreadMessages: 2,
      canMessage: true,
    });
    expect(messages.countUnread).toHaveBeenCalledWith(
      ['o1'],
      MessageSide.customer,
    );
  });

  it('should hide a deleted review but still refuse a new one', async () => {
    const { service, reviews } = build();
    reviews.findByOrderIds.mockResolvedValue([
      aReview({ deletedAt: new Date('2026-10-12T12:00:00Z') }),
    ]);

    await expect(service.forCustomer(completed, NOW)).resolves.toMatchObject({
      review: null,
      canReview: false,
    });
  });

  it('should refuse a report while the latest one is open, not after it closed', async () => {
    const { service, issues } = build();

    issues.latestForOrder.mockResolvedValue(anIssue());
    expect((await service.forCustomer(completed, NOW)).canReportIssue).toBe(
      false,
    );

    issues.latestForOrder.mockResolvedValue(
      anIssue({ status: IssueStatus.resolved }),
    );
    await expect(service.forCustomer(completed, NOW)).resolves.toMatchObject({
      issue: { status: IssueStatus.resolved },
      canReportIssue: true,
    });
  });

  it('should answer a page of cards with one query per table', async () => {
    const { service, reviews } = build();
    const second = anOrder({ ...completed, id: 'o2' });
    reviews.findByOrderIds.mockResolvedValue([aReview({ orderId: 'o2' })]);

    const cards = await service.forCustomerCards([completed, second], NOW);

    expect(reviews.findByOrderIds).toHaveBeenCalledWith(['o1', 'o2']);
    expect(cards.get('o1')).toEqual({ unreadMessages: 2, canReview: true });
    expect(cards.get('o2')).toEqual({ unreadMessages: 0, canReview: false });
  });

  it('should give the cook the review, the issue and the customer’s unread messages', async () => {
    const { service, reviews, messages } = build();
    reviews.findByOrderIds.mockResolvedValue([aReview()]);

    await expect(service.forCook(completed, NOW)).resolves.toMatchObject({
      review: { id: 'r1' },
      issue: null,
      unreadMessages: 2,
      canMessage: true,
    });
    expect(messages.countUnread).toHaveBeenCalledWith(['o1'], MessageSide.cook);
  });

  it('should sum up the cook’s rating, unreplied reviews and unread messages', async () => {
    const { service } = build();

    await expect(
      service.cookSummary(
        Object.assign(new Kitchen(), {
          id: 'k1',
          ratingAvg: 4.8,
          ratingCount: 12,
        }),
      ),
    ).resolves.toEqual({
      rating: { avg: 4.8, count: 12 },
      unrepliedReviews: 3,
      unreadMessages: 5,
    });
  });
});
```

Run: `npx jest src/orders/order-trust.service.spec.ts` → FAIL (modül yok).

- [ ] **Step 8: Sipariş ekranı güven alanları — kod**

Silinmiş değerlendirme ekranda görünmez ama yenisini engeller (`canReview` false). Açık kayıt varsa en yeni kayıt odur (aynı anda tek açık kayıt), `canReportIssue` bunu kullanır. Sipariş modülü yalnız persistence modüllerini import eder: değerlendirme/sorun/mesaj modülleri `OrdersModule`'ü import ettiği için tersini yapmak döngü olurdu.

`src/orders/order-trust.service.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { OrderIssue } from '../order-issues/domain/order-issue';
import { OrderIssueRepository } from '../order-issues/infrastructure/persistence/order-issue.repository';
import { OrderMessageRepository } from '../order-messages/infrastructure/persistence/order-message.repository';
import { Review } from '../reviews/domain/review';
import { ReviewRepository } from '../reviews/infrastructure/persistence/review.repository';
import { TrustConfig } from '../trust/config/trust-config.type';
import { canMessage, canReportIssue, canReview } from '../trust/trust-rules';
import { IssueStatus, MessageSide } from '../trust/trust.enums';
import { Order } from './domain/order';

export type CustomerOrderTrust = {
  /** null when there is none or it was deleted. */
  review: Review | null;
  canReview: boolean;
  /** The latest report, whatever its status. */
  issue: OrderIssue | null;
  canReportIssue: boolean;
  unreadMessages: number;
  canMessage: boolean;
};

export type CustomerCardTrust = Pick<
  CustomerOrderTrust,
  'unreadMessages' | 'canReview'
>;

export type CookOrderTrust = Pick<
  CustomerOrderTrust,
  'review' | 'issue' | 'unreadMessages' | 'canMessage'
>;

export type CookSummaryTrust = {
  rating: { avg: number | null; count: number };
  unrepliedReviews: number;
  unreadMessages: number;
};

/** What Faz 4 adds to the order screens: review, issue and chat state. */
@Injectable()
export class OrderTrustService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly issueRepository: OrderIssueRepository,
    private readonly messageRepository: OrderMessageRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async forCustomer(
    order: Order,
    now: Date = new Date(),
  ): Promise<CustomerOrderTrust> {
    const [[review], issue, unread] = await Promise.all([
      this.reviewRepository.findByOrderIds([order.id]),
      this.issueRepository.latestForOrder(order.id),
      this.messageRepository.countUnread([order.id], MessageSide.customer),
    ]);
    const windows = this.windows();

    return {
      review: review && !review.deletedAt ? review : null,
      canReview: canReview(
        order,
        Boolean(review),
        now,
        windows.reviewWindowDays,
      ),
      issue,
      canReportIssue: canReportIssue(
        order,
        issue?.status === IssueStatus.open,
        now,
        windows.issueWindowHours,
      ),
      unreadMessages: unread.get(order.id) ?? 0,
      canMessage: canMessage(order, now, windows.messagingWindowHours),
    };
  }

  /** One query per table for a whole page of cards. */
  async forCustomerCards(
    orders: Order[],
    now: Date = new Date(),
  ): Promise<Map<Order['id'], CustomerCardTrust>> {
    const ids = orders.map((order) => order.id);
    const [reviews, unread] = await Promise.all([
      this.reviewRepository.findByOrderIds(ids),
      this.messageRepository.countUnread(ids, MessageSide.customer),
    ]);
    const reviewed = new Set(reviews.map((review) => review.orderId));
    const { reviewWindowDays } = this.windows();

    return new Map(
      orders.map((order) => [
        order.id,
        {
          unreadMessages: unread.get(order.id) ?? 0,
          canReview: canReview(
            order,
            reviewed.has(order.id),
            now,
            reviewWindowDays,
          ),
        },
      ]),
    );
  }

  async forCook(order: Order, now: Date = new Date()): Promise<CookOrderTrust> {
    const [[review], issue, unread] = await Promise.all([
      this.reviewRepository.findByOrderIds([order.id]),
      this.issueRepository.latestForOrder(order.id),
      this.messageRepository.countUnread([order.id], MessageSide.cook),
    ]);

    return {
      review: review && !review.deletedAt ? review : null,
      issue,
      unreadMessages: unread.get(order.id) ?? 0,
      canMessage: canMessage(order, now, this.windows().messagingWindowHours),
    };
  }

  /** Unread customer messages per card of the cook's list. */
  cookUnread(orders: Order[]): Promise<Map<Order['id'], number>> {
    return this.messageRepository.countUnread(
      orders.map((order) => order.id),
      MessageSide.cook,
    );
  }

  async cookSummary(kitchen: Kitchen): Promise<CookSummaryTrust> {
    const [unrepliedReviews, unreadMessages] = await Promise.all([
      this.reviewRepository.countUnreplied(kitchen.id),
      this.messageRepository.countUnreadForKitchen(kitchen.id),
    ]);

    return {
      rating: { avg: kitchen.ratingAvg, count: kitchen.ratingCount },
      unrepliedReviews,
      unreadMessages,
    };
  }

  private windows(): TrustConfig {
    return this.configService.getOrThrow('trust', { infer: true });
  }
}
```

`src/orders/orders.module.ts` — şu bloğu:

```ts
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
```

şununla değiştir:

```ts
} from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module';
import { KitchensModule } from '../kitchens/kitchens.module';
import { RelationalOrderIssuePersistenceModule } from '../order-issues/infrastructure/persistence/relational/relational-persistence.module';
import { RelationalOrderMessagePersistenceModule } from '../order-messages/infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { RelationalReviewPersistenceModule } from '../reviews/infrastructure/persistence/relational/relational-persistence.module';
import { CookOrdersController } from './cook-orders.controller';
import { CookOrdersService } from './cook-orders.service';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderTrustService } from './order-trust.service';
import { OrdersController } from './orders.controller';
import { OrdersExpiryTask } from './orders-expiry.task';
import { OrdersService } from './orders.service';
```

`src/orders/orders.module.ts` — ardından şu bloğu:

```ts
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
  exports: [OrdersService, RelationalOrderPersistenceModule],
```

şununla değiştir:

```ts
    KitchensModule,
    ProductsModule,
    AddressesModule,
    // Read-only: the review, issue and chat state shown on order screens.
    RelationalReviewPersistenceModule,
    RelationalOrderIssuePersistenceModule,
    RelationalOrderMessagePersistenceModule,
  ],
  controllers: [OrdersController, CookOrdersController],
  providers: [
    OrdersService,
    CookOrdersService,
    OrderLifecycleService,
    OrderTrustService,
    OrdersExpiryTask,
  ],
  exports: [OrdersService, RelationalOrderPersistenceModule],
```

Run: `npx jest src/orders/order-trust.service.spec.ts` → PASS (6 test).

- [ ] **Step 9: Görünümler ve presenter'lar — test**

`src/orders/presenters.spec.ts` — dosyanın başındaki şu bloğu:

```ts
import { PaymentStatus } from '../payments/domain/payment';
import { anOrder } from './order.fixture';
import { Fulfillment, OrderStatus } from './order.enums';
import {
```

şununla değiştir:

```ts
import { anIssue } from '../order-issues/order-issue.fixture';
import { PaymentStatus } from '../payments/domain/payment';
import { aReview } from '../reviews/review.fixture';
import { CookOrderTrust, CustomerOrderTrust } from './order-trust.service';
import { anOrder } from './order.fixture';
import { Fulfillment, OrderStatus } from './order.enums';
import {
```

`src/orders/presenters.spec.ts` — ardından şu bloğu:

```ts
  kitchenAddressFor,
  shortName,
} from './presenters';

describe('shortName', () => {
  it('should keep the first name and the Turkish initial of the last', () => {
```

şununla değiştir:

```ts
  kitchenAddressFor,
  shortName,
} from './presenters';

const CUSTOMER_TRUST: CustomerOrderTrust = {
  review: null,
  canReview: false,
  issue: null,
  canReportIssue: false,
  unreadMessages: 0,
  canMessage: true,
};

const COOK_TRUST: CookOrderTrust = {
  review: null,
  issue: null,
  unreadMessages: 0,
  canMessage: true,
};

describe('shortName', () => {
  it('should keep the first name and the Turkish initial of the last', () => {
```

`src/orders/presenters.spec.ts` — ardından şu bloğu:

```ts

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
```

şununla değiştir:

```ts

describe('customerOrderCard', () => {
  it('should summarize the items and the kitchen', () => {
    expect(
      customerOrderCard(anOrder(), { unreadMessages: 2, canReview: true }),
    ).toMatchObject({
      code: 'S-7K3F',
      kitchen: { id: 'k1', name: 'Ayşe Teyze Mutfağı', coverPhoto: null },
      items: [{ name: 'Mantı', quantity: 2 }],
      totalKurus: 29400,
      unreadMessages: 2,
      canReview: true,
    });
  });
});
```

`src/orders/presenters.spec.ts` — ardından şu bloğu:

```ts
describe('customerOrderDetail', () => {
  it('should show the pickup code, the cook card and the payment', () => {
    expect(
      customerOrderDetail(anOrder(), PaymentStatus.paid, 15),
    ).toMatchObject({
      pickupCode: '0427',
      kitchen: { cookName: 'Ayşe Y.', district: 'Kadıköy' },
```

şununla değiştir:

```ts
describe('customerOrderDetail', () => {
  it('should show the pickup code, the cook card and the payment', () => {
    expect(
      customerOrderDetail(anOrder(), PaymentStatus.paid, 15, CUSTOMER_TRUST),
    ).toMatchObject({
      pickupCode: '0427',
      kitchen: { cookName: 'Ayşe Y.', district: 'Kadıköy' },
```

`src/orders/presenters.spec.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
        anOrder({ status: OrderStatus.accepted }),
        PaymentStatus.paid,
        15,
        CUSTOMER_TRUST,
      ).estimatedMinutes,
    ).toBeNull();
  });

  it('should never carry the cook’s or the customer’s contact details', () => {
    const detail = customerOrderDetail(anOrder(), null, 15, CUSTOMER_TRUST);

    expect(detail).not.toHaveProperty('customer');
    expect(detail).not.toHaveProperty('customerId');
```

`src/orders/presenters.spec.ts` — ardından şu bloğu:

```ts

describe('cook views', () => {
  it('should name the customer briefly and keep the pickup code out', () => {
    for (const view of [cookOrderCard(anOrder()), cookOrderDetail(anOrder())]) {
      expect(view).toMatchObject({
        customerName: 'Deniz İ.',
        items: [{ name: 'Mantı', note: 'Az acılı' }],
```

şununla değiştir:

```ts

describe('cook views', () => {
  it('should name the customer briefly and keep the pickup code out', () => {
    for (const view of [
      cookOrderCard(anOrder(), 0),
      cookOrderDetail(anOrder(), COOK_TRUST),
    ]) {
      expect(view).toMatchObject({
        customerName: 'Deniz İ.',
        items: [{ name: 'Mantı', note: 'Az acılı' }],
```

`src/orders/presenters.spec.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    expect(
      cookOrderDetail(
        anOrder({ fulfillment: Fulfillment.delivery, deliveryAddress }),
      ).deliveryAddress,
    ).toEqual(deliveryAddress);
  });
});
```

şununla değiştir:

```ts
    expect(
      cookOrderDetail(
        anOrder({ fulfillment: Fulfillment.delivery, deliveryAddress }),
        COOK_TRUST,
      ).deliveryAddress,
    ).toEqual(deliveryAddress);
  });
});

describe('trust on order screens', () => {
  const trust: CustomerOrderTrust = {
    review: aReview({ reply: 'Afiyet olsun' }),
    canReview: false,
    issue: anIssue({ adminNote: 'İade edildi', refundKurus: 6500 }),
    canReportIssue: false,
    unreadMessages: 3,
    canMessage: false,
  };

  it('should show the customer their review, the latest issue and the chat state', () => {
    const detail = customerOrderDetail(
      anOrder({ status: OrderStatus.completed }),
      PaymentStatus.paid,
      15,
      trust,
    );

    expect(detail).toMatchObject({
      review: { id: 'r1', rating: 5, reply: 'Afiyet olsun' },
      canReview: false,
      issue: {
        id: 'is1',
        category: 'missing_item',
        status: 'open',
        refundKurus: 6500,
        adminNote: 'İade edildi',
      },
      canReportIssue: false,
      unreadMessages: 3,
      canMessage: false,
    });
    expect(detail.issue).not.toHaveProperty('description');
    expect(detail.review).not.toHaveProperty('authorName');
  });

  it('should show the cook the same review and issue, read-only', () => {
    expect(
      cookOrderDetail(anOrder(), {
        review: trust.review,
        issue: trust.issue,
        unreadMessages: 1,
        canMessage: true,
      }),
    ).toMatchObject({
      review: { id: 'r1' },
      issue: { id: 'is1', adminNote: 'İade edildi' },
      unreadMessages: 1,
      canMessage: true,
    });
  });
});
```

Run: `npx jest src/orders/presenters.spec.ts` → FAIL (presenter'lar `trust` parametresini almıyor).

- [ ] **Step 10: Görünümler ve presenter'lar — kod**

`src/orders/views.ts` — dosyanın başındaki şu bloğu:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleType } from '../catalog/catalog.enums';
import { FileType } from '../files/domain/file';
import { PaymentStatus } from '../payments/domain/payment';
import { OrderBlocker, OrderIssueKind } from './order-pricing';
import {
  CancelledBy,
```

şununla değiştir:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SaleType } from '../catalog/catalog.enums';
import { FileType } from '../files/domain/file';
import { IssueSummaryView } from '../order-issues/views';
import { PaymentStatus } from '../payments/domain/payment';
import { OrderReviewView } from '../reviews/views';
import { OrderBlocker, OrderIssueKind } from './order-pricing';
import {
  CancelledBy,
```

`src/orders/views.ts` — ardından şu bloğu:

```ts

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;
}

/** Shared by the customer's and the cook's detail. */
```

şununla değiştir:

```ts

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;

  @ApiProperty({ type: Number, description: 'Aşçının okunmamış mesajları' })
  unreadMessages: number;

  @ApiProperty({ type: Boolean, description: '"Değerlendir" düğmesi' })
  canReview: boolean;
}

/** Shared by the customer's and the cook's detail. */
```

`src/orders/views.ts` — ardından şu bloğu:

```ts

  @ApiProperty({ type: () => OrderPaymentView, nullable: true })
  payment: OrderPaymentView | null;
}

/** GET /kitchens/me/orders — enough to answer a new order from the list. */
```

şununla değiştir:

```ts

  @ApiProperty({ type: () => OrderPaymentView, nullable: true })
  payment: OrderPaymentView | null;

  @ApiProperty({ type: () => OrderReviewView, nullable: true })
  review: OrderReviewView | null;

  @ApiProperty({ type: Boolean })
  canReview: boolean;

  @ApiProperty({
    type: () => IssueSummaryView,
    nullable: true,
    description: 'Son sorun kaydı',
  })
  issue: IssueSummaryView | null;

  @ApiProperty({ type: Boolean })
  canReportIssue: boolean;

  @ApiProperty({ type: Number })
  unreadMessages: number;

  @ApiProperty({ type: Boolean, description: 'false: sohbet salt okunur' })
  canMessage: boolean;
}

/** GET /kitchens/me/orders — enough to answer a new order from the list. */
```

`src/orders/views.ts` — ardından şu bloğu:

```ts

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;
}

/** GET /kitchens/me/orders/:id — never the pickup code or a phone number. */
```

şununla değiştir:

```ts

  @ApiProperty({ type: Date, nullable: true })
  estimatedReadyAt: Date | null;

  @ApiProperty({ type: Number, description: 'Müşterinin okunmamış mesajları' })
  unreadMessages: number;
}

/** GET /kitchens/me/orders/:id — never the pickup code or a phone number. */
```

`src/orders/views.ts` — ardından şu bloğu:

```ts

  @ApiProperty({ enum: CancelledBy, nullable: true })
  cancelledBy: CancelledBy | null;
}

export class CookTabCounts {
```

şununla değiştir:

```ts

  @ApiProperty({ enum: CancelledBy, nullable: true })
  cancelledBy: CancelledBy | null;

  @ApiProperty({ type: () => OrderReviewView, nullable: true })
  review: OrderReviewView | null;

  @ApiProperty({
    type: () => IssueSummaryView,
    nullable: true,
    description: 'Son sorun kaydı (salt okunur)',
  })
  issue: IssueSummaryView | null;

  @ApiProperty({ type: Number })
  unreadMessages: number;

  @ApiProperty({ type: Boolean })
  canMessage: boolean;
}

export class CookTabCounts {
```

`src/orders/views.ts` — ardından şu bloğu:

```ts
  revenueKurus: number;
}

/** GET /kitchens/me/orders/summary */
export class CookOrderSummary {
  @ApiProperty({ type: () => CookTabCounts })
```

şununla değiştir:

```ts
  revenueKurus: number;
}

export class KitchenRatingView {
  @ApiProperty({ type: Number, nullable: true, description: 'Tek ondalık' })
  avg: number | null;

  @ApiProperty({ type: Number })
  count: number;
}

/** GET /kitchens/me/orders/summary */
export class CookOrderSummary {
  @ApiProperty({ type: () => CookTabCounts })
```

`src/orders/views.ts` — ardından dosyanın sonundaki şu bloğu:

```ts

  @ApiProperty({ type: Boolean })
  hasEverCompleted: boolean;
}
```

şununla değiştir:

```ts

  @ApiProperty({ type: Boolean })
  hasEverCompleted: boolean;

  @ApiProperty({ type: () => KitchenRatingView })
  rating: KitchenRatingView;

  @ApiProperty({ type: Number })
  unrepliedReviews: number;

  @ApiProperty({
    type: Number,
    description: 'Tüm siparişlerdeki okunmamış müşteri mesajları',
  })
  unreadMessages: number;
}
```

`src/orders/presenters.ts` — dosyanın başındaki şu bloğu:

```ts
import { PaymentStatus } from '../payments/domain/payment';
import { Order, PersonName } from './domain/order';
import { OrderItem } from './domain/order-item';
import { OrderQuote, estimatedMinutesFor } from './order-pricing';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  CookOrderCard,
```

şununla değiştir:

```ts
import { issueSummaryView } from '../order-issues/presenters';
import { PaymentStatus } from '../payments/domain/payment';
import { orderReviewView } from '../reviews/presenters';
import { Order, PersonName } from './domain/order';
import { OrderItem } from './domain/order-item';
import { OrderQuote, estimatedMinutesFor } from './order-pricing';
import {
  CookOrderTrust,
  CustomerCardTrust,
  CustomerOrderTrust,
} from './order-trust.service';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  CookOrderCard,
```

`src/orders/presenters.ts` — ardından şu bloğu:

```ts
  closedAt: order.closedAt,
});

export function customerOrderCard(order: Order): CustomerOrderCard {
  return Object.assign(new CustomerOrderCard(), {
    id: order.id,
    code: order.code,
```

şununla değiştir:

```ts
  closedAt: order.closedAt,
});

export function customerOrderCard(
  order: Order,
  trust: CustomerCardTrust,
): CustomerOrderCard {
  return Object.assign(new CustomerOrderCard(), {
    id: order.id,
    code: order.code,
```

`src/orders/presenters.ts` — ardından şu bloğu:

```ts
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

```

şununla değiştir:

```ts
    totalKurus: order.totalKurus,
    createdAt: order.createdAt,
    estimatedReadyAt: order.estimatedReadyAt,
    unreadMessages: trust.unreadMessages,
    canReview: trust.canReview,
  });
}

```

`src/orders/presenters.ts` — ardından şu bloğu:

```ts
  order: Order,
  paymentStatus: PaymentStatus | null,
  deliveryBufferMinutes: number,
): CustomerOrderDetail {
  return Object.assign(new CustomerOrderDetail(), timeline(order), {
    id: order.id,
```

şununla değiştir:

```ts
  order: Order,
  paymentStatus: PaymentStatus | null,
  deliveryBufferMinutes: number,
  trust: CustomerOrderTrust,
): CustomerOrderDetail {
  return Object.assign(new CustomerOrderDetail(), timeline(order), {
    id: order.id,
```

`src/orders/presenters.ts` — ardından şu bloğu:

```ts
    reason: order.reason,
    cancelledBy: order.cancelledBy,
    payment: paymentStatus ? { status: paymentStatus } : null,
  });
}

export function cookOrderCard(order: Order): CookOrderCard {
  return Object.assign(new CookOrderCard(), {
    id: order.id,
    code: order.code,
```

şununla değiştir:

```ts
    reason: order.reason,
    cancelledBy: order.cancelledBy,
    payment: paymentStatus ? { status: paymentStatus } : null,
    review: trust.review ? orderReviewView(trust.review) : null,
    canReview: trust.canReview,
    issue: trust.issue ? issueSummaryView(trust.issue) : null,
    canReportIssue: trust.canReportIssue,
    unreadMessages: trust.unreadMessages,
    canMessage: trust.canMessage,
  });
}

export function cookOrderCard(
  order: Order,
  unreadMessages: number,
): CookOrderCard {
  return Object.assign(new CookOrderCard(), {
    id: order.id,
    code: order.code,
```

`src/orders/presenters.ts` — ardından şu bloğu:

```ts
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    estimatedReadyAt: order.estimatedReadyAt,
  });
}

export function cookOrderDetail(order: Order): CookOrderDetail {
  return Object.assign(new CookOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
```

şununla değiştir:

```ts
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    estimatedReadyAt: order.estimatedReadyAt,
    unreadMessages,
  });
}

export function cookOrderDetail(
  order: Order,
  trust: CookOrderTrust,
): CookOrderDetail {
  return Object.assign(new CookOrderDetail(), timeline(order), {
    id: order.id,
    code: order.code,
```

`src/orders/presenters.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    totalKurus: order.totalKurus,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
  });
}
```

şununla değiştir:

```ts
    totalKurus: order.totalKurus,
    reason: order.reason,
    cancelledBy: order.cancelledBy,
    review: trust.review ? orderReviewView(trust.review) : null,
    issue: trust.issue ? issueSummaryView(trust.issue) : null,
    unreadMessages: trust.unreadMessages,
    canMessage: trust.canMessage,
  });
}
```

Run: `npx jest src/orders/presenters.spec.ts` → PASS (12 test).

- [ ] **Step 11: Sipariş servisleri — test**

`src/orders/orders.service.spec.ts` — şu bloğu:

```ts
  OrderRepository,
} from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anOrder } from './order.fixture';
import { CancelledBy, Fulfillment, OrderStatus } from './order.enums';
import { OrdersService } from './orders.service';

// A Monday, 12:30 in Istanbul.
```

şununla değiştir:

```ts
  OrderRepository,
} from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderTrustService } from './order-trust.service';
import { anOrder } from './order.fixture';
import {
  CancelledBy,
  Fulfillment,
  OrderScope,
  OrderStatus,
} from './order.enums';
import { OrdersService } from './orders.service';

// A Monday, 12:30 in Istanbul.
```

`src/orders/orders.service.spec.ts` — ardından şu bloğu:

```ts
    charge: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
    findByOrderId: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
  };
  const config = { getOrThrow: (key: string) => CONFIG[key] };

  const service = new OrdersService(
```

şununla değiştir:

```ts
    charge: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
    findByOrderId: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
  };
  const trust = {
    forCustomer: jest.fn().mockResolvedValue({
      review: null,
      canReview: false,
      issue: null,
      canReportIssue: false,
      unreadMessages: 0,
      canMessage: true,
    }),
    forCustomerCards: jest
      .fn()
      .mockImplementation((orders: Order[]) =>
        Promise.resolve(
          new Map(
            orders.map((order) => [
              order.id,
              { unreadMessages: 1, canReview: false },
            ]),
          ),
        ),
      ),
  };
  const config = { getOrThrow: (key: string) => CONFIG[key] };

  const service = new OrdersService(
```

`src/orders/orders.service.spec.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
    products as unknown as ProductsService,
    addresses as unknown as AddressesService,
    payments as unknown as PaymentsService,
    trust as unknown as OrderTrustService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return {
    service,
    trust,
    repository,
    lifecycle,
    kitchens,
```

`src/orders/orders.service.spec.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    });
  });
});
```

şununla değiştir:

```ts
    });
  });
});

describe('OrdersService trust fields', () => {
  it('should add the unread count and canReview to every card', async () => {
    const { service, trust } = build();

    const page = await service.list(9, {
      scope: OrderScope.past,
      page: 1,
      limit: 20,
    });

    expect(trust.forCustomerCards).toHaveBeenCalledWith([anOrder()]);
    expect(page.data[0]).toMatchObject({
      id: 'o1',
      unreadMessages: 1,
      canReview: false,
    });
  });

  it('should add review, issue and chat state to the detail', async () => {
    const { service, trust } = build();

    await expect(service.detail(9, 'o1')).resolves.toMatchObject({
      review: null,
      canReview: false,
      issue: null,
      canReportIssue: false,
      unreadMessages: 0,
      canMessage: true,
    });
    expect(trust.forCustomer).toHaveBeenCalledWith(anOrder());
  });
});
```

`src/orders/cook-orders.service.spec.ts` — şu bloğu:

```ts
import { Order } from './domain/order';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anItem, anOrder } from './order.fixture';
import {
  CancelledBy,
```

şununla değiştir:

```ts
import { Order } from './domain/order';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderTrustService } from './order-trust.service';
import { anItem, anOrder } from './order.fixture';
import {
  CancelledBy,
```

`src/orders/cook-orders.service.spec.ts` — ardından şu bloğu:

```ts
  const kitchens = {
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'orders.deliveryBufferMinutes': 15 })[key],
  };
```

şununla değiştir:

```ts
  const kitchens = {
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const trust = {
    forCook: jest.fn().mockResolvedValue({
      review: null,
      issue: null,
      unreadMessages: 2,
      canMessage: true,
    }),
    cookUnread: jest.fn().mockResolvedValue(new Map([['o1', 4]])),
    cookSummary: jest.fn().mockResolvedValue({
      rating: { avg: 4.8, count: 12 },
      unrepliedReviews: 3,
      unreadMessages: 5,
    }),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'orders.deliveryBufferMinutes': 15 })[key],
  };
```

`src/orders/cook-orders.service.spec.ts` — ardından şu bloğu:

```ts
    repository as unknown as OrderRepository,
    lifecycle as unknown as OrderLifecycleService,
    kitchens as unknown as KitchensService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, repository, lifecycle, kitchens };
};

describe('CookOrdersService', () => {
```

şununla değiştir:

```ts
    repository as unknown as OrderRepository,
    lifecycle as unknown as OrderLifecycleService,
    kitchens as unknown as KitchensService,
    trust as unknown as OrderTrustService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, repository, lifecycle, kitchens, trust };
};

describe('CookOrdersService', () => {
```

`src/orders/cook-orders.service.spec.ts` — ardından şu bloğu:

```ts
      today: { orders: 3, revenueKurus: 42000 },
      week: { orders: 9, revenueKurus: 126000 },
      hasEverCompleted: true,
    });
    expect(repository.completedTotals).toHaveBeenNthCalledWith(
      1,
```

şununla değiştir:

```ts
      today: { orders: 3, revenueKurus: 42000 },
      week: { orders: 9, revenueKurus: 126000 },
      hasEverCompleted: true,
      rating: { avg: 4.8, count: 12 },
      unrepliedReviews: 3,
      unreadMessages: 5,
    });
    expect(repository.completedTotals).toHaveBeenNthCalledWith(
      1,
```

`src/orders/cook-orders.service.spec.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    });
  });
});
```

şununla değiştir:

```ts
    });
  });
});

describe('CookOrdersService trust fields', () => {
  it('should add the unread count to every card', async () => {
    const { service, trust } = build();

    const page = await service.list(7, {
      tab: CookTab.ready,
      page: 1,
      limit: 20,
    });

    expect(trust.cookUnread).toHaveBeenCalledWith([anOrder()]);
    expect(page.data[0].unreadMessages).toBe(4);
  });

  it('should add review, issue and chat state to the detail and every step', async () => {
    const { service, trust } = build(anOrder({ status: OrderStatus.accepted }));

    await expect(service.detail(7, 'o1')).resolves.toMatchObject({
      review: null,
      issue: null,
      unreadMessages: 2,
      canMessage: true,
    });
    await expect(service.start(7, 'o1')).resolves.toMatchObject({
      unreadMessages: 2,
    });
    expect(trust.forCook).toHaveBeenCalledTimes(2);
  });
});
```

Run: `npx jest src/orders/orders.service.spec.ts src/orders/cook-orders.service.spec.ts` → FAIL (constructor'lar `OrderTrustService` almıyor).

- [ ] **Step 12: Sipariş servisleri — kod**

Aşçının her durum eylemi de güncel detayı döndürdüğü için güven alanları `present()` üzerinden her yanıta eklenir.

`src/orders/orders.service.ts` — şu bloğu:

```ts
import { activeOrdersExist, orderTotalChanged } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderQuote, quoteFieldErrors, quoteOrder } from './order-pricing';
import { ACTIVE_STATUSES, CLOSED_STATUSES } from './order-status';
import {
  CancelledBy,
```

şununla değiştir:

```ts
import { activeOrdersExist, orderTotalChanged } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderQuote, quoteFieldErrors, quoteOrder } from './order-pricing';
import { CustomerCardTrust, OrderTrustService } from './order-trust.service';
import { ACTIVE_STATUSES, CLOSED_STATUSES } from './order-status';
import {
  CancelledBy,
```

`src/orders/orders.service.ts` — ardından şu bloğu:

```ts
    private readonly productsService: ProductsService,
    private readonly addressesService: AddressesService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

```

şununla değiştir:

```ts
    private readonly productsService: ProductsService,
    private readonly addressesService: AddressesService,
    private readonly paymentsService: PaymentsService,
    private readonly trust: OrderTrustService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

```

`src/orders/orders.service.ts` — ardından şu bloğu:

```ts
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    return infinityPagination(orders.map(customerOrderCard), {
      page: query.page,
      limit: query.limit,
    });
  }

  async detail(
```

şununla değiştir:

```ts
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    const trust = await this.trust.forCustomerCards(orders);

    return infinityPagination(
      orders.map((order) =>
        customerOrderCard(order, trust.get(order.id) as CustomerCardTrust),
      ),
      { page: query.page, limit: query.limit },
    );
  }

  async detail(
```

`src/orders/orders.service.ts` — ardından şu bloğu:

```ts
  }

  private async present(order: Order): Promise<CustomerOrderDetail> {
    const payment = await this.paymentsService.findByOrderId(order.id);
    return customerOrderDetail(
      order,
      payment?.status ?? null,
      this.bufferMinutes(),
    );
  }

```

şununla değiştir:

```ts
  }

  private async present(order: Order): Promise<CustomerOrderDetail> {
    const [payment, trust] = await Promise.all([
      this.paymentsService.findByOrderId(order.id),
      this.trust.forCustomer(order),
    ]);
    return customerOrderDetail(
      order,
      payment?.status ?? null,
      this.bufferMinutes(),
      trust,
    );
  }

```

`src/orders/cook-orders.service.ts` — şu bloğu:

```ts
import { orderStatusConflict } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { estimatedMinutesFor, estimatedReadyAt } from './order-pricing';
import { OrderAction, canTransition } from './order-status';
import { istanbulDayStart, istanbulWeekStart } from './order-time';
import {
```

şununla değiştir:

```ts
import { orderStatusConflict } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { estimatedMinutesFor, estimatedReadyAt } from './order-pricing';
import { OrderTrustService } from './order-trust.service';
import { OrderAction, canTransition } from './order-status';
import { istanbulDayStart, istanbulWeekStart } from './order-time';
import {
```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
    private readonly orderRepository: OrderRepository,
    private readonly lifecycle: OrderLifecycleService,
    private readonly kitchensService: KitchensService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

```

şununla değiştir:

```ts
    private readonly orderRepository: OrderRepository,
    private readonly lifecycle: OrderLifecycleService,
    private readonly kitchensService: KitchensService,
    private readonly trust: OrderTrustService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    const unread = await this.trust.cookUnread(orders);

    return infinityPagination(
      orders.map((order) => cookOrderCard(order, unread.get(order.id) ?? 0)),
      { page: query.page, limit: query.limit },
    );
  }

  async summary(ownerId: User['id']): Promise<CookOrderSummary> {
    const kitchen = await this.kitchen(ownerId);
    const now = new Date();
    const [counts, today, week, hasEverCompleted, trust] = await Promise.all([
      this.orderRepository.countByStatus(kitchen.id, [
        OrderStatus.pending,
        OrderStatus.accepted,
```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
      this.orderRepository.completedTotals(kitchen.id, istanbulDayStart(now)),
      this.orderRepository.completedTotals(kitchen.id, istanbulWeekStart(now)),
      this.orderRepository.hasCompleted(kitchen.id),
    ]);
    const count = (status: OrderStatus) => counts[status] ?? 0;

```

şununla değiştir:

```ts
      this.orderRepository.completedTotals(kitchen.id, istanbulDayStart(now)),
      this.orderRepository.completedTotals(kitchen.id, istanbulWeekStart(now)),
      this.orderRepository.hasCompleted(kitchen.id),
      this.trust.cookSummary(kitchen),
    ]);
    const count = (status: OrderStatus) => counts[status] ?? 0;

```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
      today,
      week,
      hasEverCompleted,
    };
  }

  async detail(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return cookOrderDetail(await this.order(ownerId, id));
  }

  /** Writes estimatedReadyAt: now + longest prep (+ buffer for delivery). */
```

şununla değiştir:

```ts
      today,
      week,
      hasEverCompleted,
      ...trust,
    };
  }

  async detail(ownerId: User['id'], id: Order['id']): Promise<CookOrderDetail> {
    return this.present(await this.order(ownerId, id));
  }

  /** Writes estimatedReadyAt: now + longest prep (+ buffer for delivery). */
```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
      }),
    );

    return cookOrderDetail(
      await this.lifecycle.advance(
        order,
        'accept',
```

şununla değiştir:

```ts
      }),
    );

    return this.present(
      await this.lifecycle.advance(
        order,
        'accept',
```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
      }
    }

    return cookOrderDetail(await this.lifecycle.advance(order, 'complete'));
  }

  cancel(
```

şununla değiştir:

```ts
      }
    }

    return this.present(await this.lifecycle.advance(order, 'complete'));
  }

  cancel(
```

`src/orders/cook-orders.service.ts` — ardından şu bloğu:

```ts
    patch: OrderPatch = {},
  ): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);
    return cookOrderDetail(await this.lifecycle.advance(order, action, patch));
  }

  /** The cook's kitchen (404 without one), with overdue orders already expired. */
```

şununla değiştir:

```ts
    patch: OrderPatch = {},
  ): Promise<CookOrderDetail> {
    const order = await this.order(ownerId, id);
    return this.present(await this.lifecycle.advance(order, action, patch));
  }

  private async present(order: Order): Promise<CookOrderDetail> {
    return cookOrderDetail(order, await this.trust.forCook(order));
  }

  /** The cook's kitchen (404 without one), with overdue orders already expired. */
```

Run: `npx jest src/orders src/order-messages && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: PASS, tip hatası yok, lint temiz. Dev API logunda dört mesaj rotası, `ERROR` yok.

- [ ] **Step 13: e2e — sohbet ve sipariş ekranları**

Faz 3 e2e'sindeki özet beklentisi yeni alanları içerir:

`test/user/orders.e2e-spec.ts` — şu bloğu:

```ts
            today: { orders: 2, revenueKurus: 28000 },
            week: { orders: 2, revenueKurus: 28000 },
            hasEverCompleted: true,
          });
        }));

```

şununla değiştir:

```ts
            today: { orders: 2, revenueKurus: 28000 },
            week: { orders: 2, revenueKurus: 28000 },
            hasEverCompleted: true,
            rating: { avg: null, count: 0 },
            unrepliedReviews: 0,
            unreadMessages: 0,
          });
        }));

```

`test/user/order-messages.e2e-spec.ts` — dosyanın tamamı:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Cart,
  addProduct,
  categoryId,
  completeOrder,
  cookStep,
  openKitchen,
  phoneLogin,
  placeOrder,
  randomSpot,
  setName,
  testDatabase,
  uniquePhone,
} from '../utils/orders';

type Card = { id: string } & Record<string, unknown>;

describe('Order chat and trust fields', () => {
  const app = APP_URL;
  const db = testDatabase();
  let cook: string;
  let otherCook: string;
  let customer: string;
  let stranger: string;
  let cart: Cart;
  let orderId: string;
  let firstMessageAt: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const customerUnread = async (id = orderId) =>
    (await get(`/orders/${id}`, customer).expect(200)).body.data
      .unreadMessages as number;
  const cookUnread = async (id = orderId) =>
    (await get(`/kitchens/me/orders/${id}`, cook).expect(200)).body.data
      .unreadMessages as number;

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90573'));
    otherCook = await phoneLogin(uniquePhone('+90574'));
    customer = await phoneLogin(uniquePhone('+90575'));
    stranger = await phoneLogin(uniquePhone('+90576'));
    await setName(customer, 'Deniz', 'Arslan');

    const kitchenId = await openKitchen(cook, randomSpot());
    await openKitchen(otherCook, randomSpot());
    const productId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    cart = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId, quantity: 1 }],
    };

    orderId = (await placeOrder(customer, cart)).id;
    await cookStep(cook, orderId, 'accept');
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('messaging', () => {
    it('should open an empty, writable chat', () =>
      get(`/orders/${orderId}/messages`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({ data: [], canMessage: true });
        }));

    it('should 422 an empty or too long message', async () => {
      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: '   ' })
        .expect(422);
      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: 'x'.repeat(501) })
        .expect(422);
    });

    it('should deliver the customer’s message to the cook as unread', async () => {
      const { body } = await post(`/orders/${orderId}/messages`, customer)
        .send({ body: '  Zili çalmayın, bebek uyuyor  ' })
        .expect(201);
      firstMessageAt = body.data.createdAt;

      expect(body.data).toMatchObject({
        senderRole: 'customer',
        body: 'Zili çalmayın, bebek uyuyor',
      });
      expect(body.data).not.toHaveProperty('senderId');

      expect(await cookUnread()).toBe(1);
      await get('/kitchens/me/orders?tab=preparing', cook)
        .expect(200)
        .expect(({ body: page }) => {
          const card = page.data.data.find((c: Card) => c.id === orderId);
          expect(card.unreadMessages).toBe(1);
        });
      await get('/kitchens/me/orders/summary', cook)
        .expect(200)
        .expect(({ body: summary }) => {
          expect(summary.data.unreadMessages).toBe(1);
        });
    });

    it('should clear the cook’s unread count once the cook reads', async () => {
      await get(`/kitchens/me/orders/${orderId}/messages`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data).toEqual([
            expect.objectContaining({
              senderRole: 'customer',
              body: 'Zili çalmayın, bebek uyuyor',
            }),
          ]);
        });

      expect(await cookUnread()).toBe(0);
      const [row] = await db.query(
        'SELECT "cookLastReadAt", "customerLastReadAt" FROM "order" WHERE "id" = $1',
        [orderId],
      );
      expect((row.cookLastReadAt as Date).getTime()).toBeGreaterThanOrEqual(
        Date.parse(firstMessageAt),
      );
      expect(row.customerLastReadAt).toBeInstanceOf(Date);
    });

    it('should return only newer messages with `after`, oldest first', async () => {
      await post(`/kitchens/me/orders/${orderId}/messages`, cook)
        .send({ body: 'Tamam, kapıdan ararım' })
        .expect(201);
      await post(`/kitchens/me/orders/${orderId}/messages`, cook)
        .send({ body: 'Siparişin hazır' })
        .expect(201);

      expect(await customerUnread()).toBe(2);
      await get('/orders?scope=active', customer)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find((c: Card) => c.id === orderId);
          expect(card.unreadMessages).toBe(2);
        });

      await get(
        `/orders/${orderId}/messages?after=${encodeURIComponent(firstMessageAt)}`,
        customer,
      )
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((m: { body: string }) => m.body)).toEqual([
            'Tamam, kapıdan ararım',
            'Siparişin hazır',
          ]);
        });

      expect(await customerUnread()).toBe(0);
    });

    it('should 422 a malformed `after`', () =>
      get(`/orders/${orderId}/messages?after=yesterday`, customer).expect(422));

    it('should keep everyone else out', async () => {
      await get(`/orders/${orderId}/messages`, stranger).expect(404);
      await post(`/orders/${orderId}/messages`, stranger)
        .send({ body: 'Merhaba' })
        .expect(404);
      await get(`/kitchens/me/orders/${orderId}/messages`, otherCook).expect(
        404,
      );
    });

    it('should go read-only 24 hours after the order closed', async () => {
      await cookStep(cook, orderId, 'start');
      await cookStep(cook, orderId, 'ready');
      const { body } = await get(`/orders/${orderId}`, customer).expect(200);
      await cookStep(cook, orderId, 'complete', {
        pickupCode: body.data.pickupCode,
      });

      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: 'Teşekkürler!' })
        .expect(201);

      await db.query(
        `UPDATE "order" SET "completedAt" = now() - interval '25 hours' WHERE "id" = $1`,
        [orderId],
      );

      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: 'Bir şey daha' })
        .expect(409)
        .expect(({ body: error }) => {
          expect(error.message).toBe('messagingClosed');
        });
      await post(`/kitchens/me/orders/${orderId}/messages`, cook)
        .send({ body: 'Rica ederim' })
        .expect(409);
      await get(`/orders/${orderId}/messages`, customer)
        .expect(200)
        .expect(({ body: chat }) => {
          expect(chat.data.canMessage).toBe(false);
          expect(chat.data.data).toHaveLength(4);
        });
    });
  });

  describe('review and issue on the order screens', () => {
    let completed: string;

    beforeAll(async () => {
      completed = await completeOrder(cook, customer, cart);
    });

    it('should offer a review and a report on a fresh completed order', async () => {
      await get(`/orders/${completed}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            review: null,
            canReview: true,
            issue: null,
            canReportIssue: true,
            unreadMessages: 0,
            canMessage: true,
          });
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find((c: Card) => c.id === completed);
          expect(card).toMatchObject({ canReview: true, unreadMessages: 0 });
        });
    });

    it('should show the review and the open report to both sides', async () => {
      await post(`/orders/${completed}/review`, customer)
        .send({ rating: 5, comment: 'Harika' })
        .expect(201);
      await post(`/orders/${completed}/issues`, customer)
        .send({
          category: 'late',
          description: 'Teslim kodu ekranında 20 dk bekledim.',
          requestedResolution: 'none',
        })
        .expect(201);

      await get(`/orders/${completed}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            review: { rating: 5, comment: 'Harika', reply: null },
            canReview: false,
            issue: {
              category: 'late',
              status: 'open',
              refundKurus: null,
              adminNote: null,
            },
            canReportIssue: false,
          });
        });

      await get(`/kitchens/me/orders/${completed}`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            review: { rating: 5 },
            issue: { category: 'late', status: 'open' },
            canMessage: true,
          });
          expect(body.data.issue).not.toHaveProperty('description');
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find((c: Card) => c.id === completed);
          expect(card.canReview).toBe(false);
        });
    });

    it('should sum up the rating and unreplied reviews for the cook', () =>
      get('/kitchens/me/orders/summary', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            rating: { avg: 5, count: 1 },
            unrepliedReviews: 1,
            unreadMessages: 1,
          });
        }));
  });
});
```

Run: `npm run test:e2e -- --runInBand test/user/order-messages.e2e-spec.ts test/user/orders.e2e-spec.ts`
Expected: PASS (11 + 35 test).

- [ ] **Step 14: Tüm paket ve commit**

Run: `npm run lint && npm test && npm run test:e2e -- --runInBand` → temiz, PASS.

```bash
git add src/order-messages src/orders src/reviews src/order-issues src/app.module.ts test/user/order-messages.e2e-spec.ts test/user/orders.e2e-spec.ts
git commit -m "feat(order-messages): chat per order with unread counts and trust fields on order screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Hesap silme, geliştirme seed'i, belgeler, son doğrulama

**Files:**
- Modify: `src/reviews/infrastructure/persistence/review.repository.ts`, `src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts` (`softDeleteByAuthor`, `softDeleteByKitchen`, `ratingGroupsOf` export), `src/reviews/reviews.service.ts`, `src/reviews/reviews.service.spec.ts`
- Modify: `src/favorites/infrastructure/persistence/favorite.repository.ts`, `src/favorites/infrastructure/persistence/relational/repositories/favorite.repository.ts`, `src/favorites/favorites.service.ts`
- Modify: `src/order-messages/infrastructure/persistence/order-message.repository.ts`, `src/order-messages/infrastructure/persistence/relational/repositories/order-message.repository.ts`, `src/order-messages/order-messages.service.ts`
- Modify: `src/users/users.service.ts`, `src/users/users.service.spec.ts`, `src/users/users.module.ts`
- Test: `test/user/trust-deletion.e2e-spec.ts`
- Modify: `src/database/seeds/relational/order/order-seed.service.ts`, `src/database/seeds/relational/run-seed.ts`, `src/database/seeds/relational/seed.module.ts`
- Create: `src/database/seeds/relational/trust/trust-seed.module.ts`, `src/database/seeds/relational/trust/trust-seed.service.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 3 (`ReviewRepository`, `ReviewsService`, `ratingSummary`), Task 4 (`FavoriteRepository`, `FavoritesService`), Task 6 (`OrderMessageRepository`, `OrderMessagesService`), Faz 3 `OrderSeedService`, entity'ler (Task 2).
- Produces:
  - `ReviewRepository.softDeleteByAuthor(authorId)` (silinmemiş değerlendirmeler soft-delete, `comment = null`, `photos = []`; etkilenen her mutfak kilitlenip yeniden hesaplanır — tek transaction), `ReviewRepository.softDeleteByKitchen(kitchenId)` (soft-delete, `reply`/`repliedAt` null, yeniden hesap); `export async function ratingGroupsOf(manager: EntityManager, kitchenId): Promise<RatingGroup[]>`.
  - `ReviewsService.removeForUser(userId)`, `FavoriteRepository.removeAllForUser(userId)` / `FavoritesService.removeAllForUser(userId)`, `OrderMessageRepository.removeAllBySender(senderId)` / `OrderMessagesService.removeAllForUser(userId)`.
  - `UsersService.remove` sırası: **409 kontrolü → anonimleştirme → sipariş adresleri → değerlendirmeler → favoriler → mesajlar → ürünler → mutfak → adresler → oturumlar**; `UsersModule` `ReviewsModule`, `FavoritesModule`, `OrderMessagesModule`'ü import eder (üçü de `UsersModule`'e bağlı değil, döngü yok).
  - `OrderSeedService.addOrder(seed: SeedOrder, kitchen, customer, menu): Promise<OrderEntity>`, `OrderSeedService.menuOf(kitchen)`, `export type SeedOrder`; `TrustSeedService.run(): Promise<void>` (yalnız production dışı, bir kez).

- [ ] **Step 1: Silme yardımcıları — repository'ler**

Müşterinin değerlendirmesi soft-delete edilirken yorum ve fotoğraflar da temizlenir (KVKK; Faz 2'de mutfağın soft-delete ile birlikte temizlenmesi emsali). Mutfak kilitleri id sırasıyla alınır: iki eşzamanlı silme kilitlenmez.

`src/reviews/infrastructure/persistence/review.repository.ts` — dosyanın sonundaki şu bloğu:

```ts

  /** Reports of reviews that are not deleted; newest first. */
  abstract listReports(page: ReviewPage): Promise<ReviewReport[]>;
}
```

şununla değiştir:

```ts

  /** Reports of reviews that are not deleted; newest first. */
  abstract listReports(page: ReviewPage): Promise<ReviewReport[]>;

  /**
   * Account deletion of a customer: their reviews are soft-deleted with the
   * comment and photos scrubbed (KVKK), and every affected kitchen's rating
   * is recomputed — one transaction.
   */
  abstract softDeleteByAuthor(authorId: User['id']): Promise<void>;

  /** Account deletion of a cook: the kitchen's reviews go, their replies scrubbed. */
  abstract softDeleteByKitchen(kitchenId: Kitchen['id']): Promise<void>;
}
```

`src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts` — şu bloğu:

```ts
  (error.driverError as { code?: string }).code === '23505' &&
  (error.driverError as { table?: string }).table === table;

/** Grouped exactly as ratingSummary() expects; deleted rows included on purpose. */
async function ratingGroupsOf(
  manager: EntityManager,
  kitchenId: Kitchen['id'],
): Promise<RatingGroup[]> {
```

şununla değiştir:

```ts
  (error.driverError as { code?: string }).code === '23505' &&
  (error.driverError as { table?: string }).table === table;

/**
 * Grouped exactly as ratingSummary() expects; deleted rows included on
 * purpose. Also used by the dev seed to recompute kitchen ratings.
 */
export async function ratingGroupsOf(
  manager: EntityManager,
  kitchenId: Kitchen['id'],
): Promise<RatingGroup[]> {
```

`src/reviews/infrastructure/persistence/relational/repositories/review.repository.ts` — ardından şu bloğu:

```ts
    return entities.map((entity) => ReviewReportMapper.toDomain(entity));
  }

  /** Serializes the rating writers of one kitchen (READ COMMITTED would lose updates). */
  private async lockKitchen(
    manager: EntityManager,
```

şununla değiştir:

```ts
    return entities.map((entity) => ReviewReportMapper.toDomain(entity));
  }

  async softDeleteByAuthor(authorId: User['id']): Promise<void> {
    await this.reviews.manager.transaction(async (manager) => {
      const rows = await manager
        .createQueryBuilder(ReviewEntity, 'r')
        .select('DISTINCT r."kitchenId"', 'kitchenId')
        .where('r."authorId" = :authorId', { authorId: Number(authorId) })
        .getRawMany<{ kitchenId: string }>();
      // Always the same lock order: no deadlock with another deletion.
      const kitchenIds = rows.map((row) => row.kitchenId).sort();

      for (const kitchenId of kitchenIds) {
        await this.lockKitchen(manager, kitchenId);
      }

      await manager
        .createQueryBuilder()
        .update(ReviewEntity)
        .set({ deletedAt: () => 'now()', comment: null, photos: [] })
        .where('"authorId" = :authorId', { authorId: Number(authorId) })
        .andWhere('"deletedAt" IS NULL')
        .execute();

      for (const kitchenId of kitchenIds) {
        await this.recompute(manager, kitchenId);
      }
    });
  }

  async softDeleteByKitchen(kitchenId: Kitchen['id']): Promise<void> {
    await this.reviews.manager.transaction(async (manager) => {
      await this.lockKitchen(manager, kitchenId);
      await manager
        .createQueryBuilder()
        .update(ReviewEntity)
        .set({ deletedAt: () => 'now()', reply: null, repliedAt: null })
        .where('"kitchenId" = :kitchenId', { kitchenId })
        .andWhere('"deletedAt" IS NULL')
        .execute();
      await this.recompute(manager, kitchenId);
    });
  }

  /** Serializes the rating writers of one kitchen (READ COMMITTED would lose updates). */
  private async lockKitchen(
    manager: EntityManager,
```

`src/favorites/infrastructure/persistence/favorite.repository.ts` — şu bloğu:

```ts
    page: FavoritePage,
  ): Promise<Kitchen[]>;

  /** Which of `kitchenIds` the user has favorited. */
  abstract favoriteKitchenIds(
    userId: User['id'],
```

şununla değiştir:

```ts
    page: FavoritePage,
  ): Promise<Kitchen[]>;

  /** Account deletion. */
  abstract removeAllForUser(userId: User['id']): Promise<void>;

  /** Which of `kitchenIds` the user has favorited. */
  abstract favoriteKitchenIds(
    userId: User['id'],
```

`src/favorites/infrastructure/persistence/relational/repositories/favorite.repository.ts` — şu bloğu:

```ts

  async remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    await this.favorites.delete({ userId: Number(userId), kitchenId });
  }

  async listKitchens(
```

şununla değiştir:

```ts

  async remove(userId: User['id'], kitchenId: Kitchen['id']): Promise<void> {
    await this.favorites.delete({ userId: Number(userId), kitchenId });
  }

  async removeAllForUser(userId: User['id']): Promise<void> {
    await this.favorites.delete({ userId: Number(userId) });
  }

  async listKitchens(
```

`src/order-messages/infrastructure/persistence/order-message.repository.ts` — dosyanın başındaki şu bloğu:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { Order } from '../../../orders/domain/order';
import { MessageSide } from '../../../trust/trust.enums';
import { NewOrderMessage, OrderMessage } from '../../domain/order-message';

export abstract class OrderMessageRepository {
```

şununla değiştir:

```ts
import { Kitchen } from '../../../kitchens/domain/kitchen';
import { Order } from '../../../orders/domain/order';
import { MessageSide } from '../../../trust/trust.enums';
import { User } from '../../../users/domain/user';
import { NewOrderMessage, OrderMessage } from '../../domain/order-message';

export abstract class OrderMessageRepository {
```

`src/order-messages/infrastructure/persistence/order-message.repository.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    viewer: MessageSide,
  ): Promise<Map<Order['id'], number>>;

  /** Customers' messages the cook has not read, over every order of the kitchen. */
  abstract countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number>;
}
```

şununla değiştir:

```ts
    viewer: MessageSide,
  ): Promise<Map<Order['id'], number>>;

  /** Account deletion: everything the user wrote, as either side. */
  abstract removeAllBySender(senderId: User['id']): Promise<void>;

  /** Customers' messages the cook has not read, over every order of the kitchen. */
  abstract countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number>;
}
```

`src/order-messages/infrastructure/persistence/relational/repositories/order-message.repository.ts` — şu bloğu:

```ts
import { Order } from '../../../../../orders/domain/order';
import { unreadRule } from '../../../../../trust/trust-rules';
import { MessageSide } from '../../../../../trust/trust.enums';
import {
  NewOrderMessage,
  OrderMessage,
```

şununla değiştir:

```ts
import { Order } from '../../../../../orders/domain/order';
import { unreadRule } from '../../../../../trust/trust-rules';
import { MessageSide } from '../../../../../trust/trust.enums';
import { User } from '../../../../../users/domain/user';
import {
  NewOrderMessage,
  OrderMessage,
```

`src/order-messages/infrastructure/persistence/relational/repositories/order-message.repository.ts` — ardından şu bloğu:

```ts
    return new Map(rows.map((row) => [row.orderId, Number(row.count)]));
  }

  async countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number> {
    const { condition, senderRole } = unreadFor(MessageSide.cook);
    const row = await this.messages
```

şununla değiştir:

```ts
    return new Map(rows.map((row) => [row.orderId, Number(row.count)]));
  }

  async removeAllBySender(senderId: User['id']): Promise<void> {
    await this.messages.delete({ senderId: Number(senderId) });
  }

  async countUnreadForKitchen(kitchenId: Kitchen['id']): Promise<number> {
    const { condition, senderRole } = unreadFor(MessageSide.cook);
    const row = await this.messages
```

Run: `npx tsc --noEmit -p tsconfig.json` → hata yok.

- [ ] **Step 2: Servisler — test**

`src/reviews/reviews.service.spec.ts` — şu bloğu:

```ts
      ),
    addReport: jest.fn().mockResolvedValue(undefined),
    listReports: jest.fn().mockResolvedValue([]),
  };
  const orders = { findForCustomer: jest.fn().mockResolvedValue(order) };
  const kitchens = {
    findById: jest.fn().mockResolvedValue({ id: 'k1' }),
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const files = {
    findByIds: jest.fn((ids: string[]) =>
```

şununla değiştir:

```ts
      ),
    addReport: jest.fn().mockResolvedValue(undefined),
    listReports: jest.fn().mockResolvedValue([]),
    softDeleteByAuthor: jest.fn().mockResolvedValue(undefined),
    softDeleteByKitchen: jest.fn().mockResolvedValue(undefined),
  };
  const orders = { findForCustomer: jest.fn().mockResolvedValue(order) };
  const kitchens = {
    findById: jest.fn().mockResolvedValue({ id: 'k1' }),
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
    findByOwner: jest.fn().mockResolvedValue(null),
  };
  const files = {
    findByIds: jest.fn((ids: string[]) =>
```

`src/reviews/reviews.service.spec.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
    );
  });
});
```

şununla değiştir:

```ts
    );
  });
});

describe('ReviewsService.removeForUser', () => {
  it('should remove the user’s reviews and, for a cook, the kitchen’s', async () => {
    const { service, reviews, kitchens } = build();
    kitchens.findByOwner.mockResolvedValueOnce({ id: 'k1' });

    await service.removeForUser(7);
    expect(reviews.softDeleteByAuthor).toHaveBeenCalledWith(7);
    expect(reviews.softDeleteByKitchen).toHaveBeenCalledWith('k1');

    await service.removeForUser(9);
    expect(reviews.softDeleteByAuthor).toHaveBeenCalledWith(9);
    expect(reviews.softDeleteByKitchen).toHaveBeenCalledTimes(1);
  });
});
```

`src/users/users.service.spec.ts` — dosyanın başındaki şu bloğu:

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
```

şununla değiştir:

```ts
import { ConflictException } from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { FavoritesService } from '../favorites/favorites.service';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { OrderMessagesService } from '../order-messages/order-messages.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { ReviewsService } from '../reviews/reviews.service';
import { SessionService } from '../session/session.service';
import { User } from './domain/user';
import { UserRepository } from './infrastructure/persistence/user.repository';
```

`src/users/users.service.spec.ts` — ardından şu bloğu:

```ts
    assertNoActiveOrders: jest.fn().mockResolvedValue(undefined),
    clearDeliveryAddresses: jest.fn(),
  };

  const service = new UsersService(
    repository as unknown as UserRepository,
```

şununla değiştir:

```ts
    assertNoActiveOrders: jest.fn().mockResolvedValue(undefined),
    clearDeliveryAddresses: jest.fn(),
  };
  const reviews = { removeForUser: jest.fn() };
  const favorites = { removeAllForUser: jest.fn() };
  const messages = { removeAllForUser: jest.fn() };

  const service = new UsersService(
    repository as unknown as UserRepository,
```

`src/users/users.service.spec.ts` — ardından şu bloğu:

```ts
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
    orders as unknown as OrdersService,
  );

  return {
```

şununla değiştir:

```ts
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
    orders as unknown as OrdersService,
    reviews as unknown as ReviewsService,
    favorites as unknown as FavoritesService,
    messages as unknown as OrderMessagesService,
  );

  return {
```

`src/users/users.service.spec.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
    kitchens,
    products,
    orders,
    reviews,
    favorites,
    messages,
  };
};

describe('UsersService.remove', () => {
  it('should anonymize the user, then remove order addresses, reviews, favorites, messages, the menu, kitchen, addresses and sessions', async () => {
    const {
      service,
      repository,
```

`src/users/users.service.spec.ts` — ardından şu bloğu:

```ts
      kitchens,
      products,
      orders,
    } = buildUsersService();

    await service.remove(7);
```

şununla değiştir:

```ts
      kitchens,
      products,
      orders,
      reviews,
      favorites,
      messages,
    } = buildUsersService();

    await service.remove(7);
```

`src/users/users.service.spec.ts` — ardından şu bloğu:

```ts
    expect(orders.assertNoActiveOrders).toHaveBeenCalledWith(7);
    expect(repository.anonymizeAndSoftDelete).toHaveBeenCalledWith(7);
    expect(orders.clearDeliveryAddresses).toHaveBeenCalledWith(7);
    expect(products.removeAllForOwner).toHaveBeenCalledWith(7);
    expect(kitchens.removeForOwner).toHaveBeenCalledWith(7);
    expect(addresses.removeAllForUser).toHaveBeenCalledWith(7);
```

şununla değiştir:

```ts
    expect(orders.assertNoActiveOrders).toHaveBeenCalledWith(7);
    expect(repository.anonymizeAndSoftDelete).toHaveBeenCalledWith(7);
    expect(orders.clearDeliveryAddresses).toHaveBeenCalledWith(7);
    expect(reviews.removeForUser).toHaveBeenCalledWith(7);
    expect(favorites.removeAllForUser).toHaveBeenCalledWith(7);
    expect(messages.removeAllForUser).toHaveBeenCalledWith(7);
    expect(products.removeAllForOwner).toHaveBeenCalledWith(7);
    expect(kitchens.removeForOwner).toHaveBeenCalledWith(7);
    expect(addresses.removeAllForUser).toHaveBeenCalledWith(7);
```

`src/users/users.service.spec.ts` — ardından şu bloğu:

```ts
      orders.assertNoActiveOrders,
      repository.anonymizeAndSoftDelete,
      orders.clearDeliveryAddresses,
      products.removeAllForOwner,
      kitchens.removeForOwner,
      addresses.removeAllForUser,
```

şununla değiştir:

```ts
      orders.assertNoActiveOrders,
      repository.anonymizeAndSoftDelete,
      orders.clearDeliveryAddresses,
      reviews.removeForUser,
      favorites.removeAllForUser,
      messages.removeAllForUser,
      products.removeAllForOwner,
      kitchens.removeForOwner,
      addresses.removeAllForUser,
```

Run: `npx jest src/reviews/reviews.service.spec.ts src/users/users.service.spec.ts` → FAIL (`removeForUser` yok; `UsersService` 10 argüman almıyor).

- [ ] **Step 3: Servisler — kod**

Değerlendirmeler mutfaktan önce silinir: aşçının mutfağı `findByOwner` ile bulunur, mutfak soft-delete olunca bulunamaz.

`src/reviews/reviews.service.ts` — şu bloğu:

```ts
    );
  }

  /** A review of the cook's own kitchen (404 without a kitchen or for another's). */
  private async mine(ownerId: User['id'], id: Review['id']): Promise<Review> {
    const kitchen = await this.kitchensService.findMine(ownerId);
```

şununla değiştir:

```ts
    );
  }

  /**
   * Account deletion, before the kitchen goes: the user's reviews (scrubbed,
   * ratings recomputed) and, for a cook, the kitchen's reviews and replies.
   */
  async removeForUser(userId: User['id']): Promise<void> {
    await this.reviewRepository.softDeleteByAuthor(userId);
    const kitchen = await this.kitchensService.findByOwner(userId);

    if (kitchen) {
      await this.reviewRepository.softDeleteByKitchen(kitchen.id);
    }
  }

  /** A review of the cook's own kitchen (404 without a kitchen or for another's). */
  private async mine(ownerId: User['id'], id: Review['id']): Promise<Review> {
    const kitchen = await this.kitchensService.findMine(ownerId);
```

`src/favorites/favorites.service.ts` — şu bloğu:

```ts
    );
  }

  async favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
```

şununla değiştir:

```ts
    );
  }

  /** Account deletion: hard delete. */
  removeAllForUser(userId: User['id']): Promise<void> {
    return this.favoriteRepository.removeAllForUser(userId);
  }

  async favoriteKitchenIds(
    userId: User['id'],
    kitchenIds: Kitchen['id'][],
```

`src/order-messages/order-messages.service.ts` — şu bloğu:

```ts
    return this.send(order, ownerId, MessageSide.cook, body);
  }

  /** Moves the reader's marker to now, then returns the messages. */
  private async read(
    order: Order,
```

şununla değiştir:

```ts
    return this.send(order, ownerId, MessageSide.cook, body);
  }

  /** Account deletion: the user's messages are hard-deleted (the other side's stay). */
  removeAllForUser(userId: User['id']): Promise<void> {
    return this.messageRepository.removeAllBySender(userId);
  }

  /** Moves the reader's marker to now, then returns the messages. */
  private async read(
    order: Order,
```

`src/users/users.service.ts` — şu bloğu:

```ts
import { KitchensService } from '../kitchens/kitchens.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class UsersService {
```

şununla değiştir:

```ts
import { KitchensService } from '../kitchens/kitchens.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { ReviewsService } from '../reviews/reviews.service';
import { FavoritesService } from '../favorites/favorites.service';
import { OrderMessagesService } from '../order-messages/order-messages.service';

@Injectable()
export class UsersService {
```

`src/users/users.service.ts` — ardından şu bloğu:

```ts
    private readonly kitchensService: KitchensService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
```

şununla değiştir:

```ts
    private readonly kitchensService: KitchensService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
    private readonly reviewsService: ReviewsService,
    private readonly favoritesService: FavoritesService,
    private readonly orderMessagesService: OrderMessagesService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
```

`src/users/users.service.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
   * The only account-deletion path (DELETE /auth/me and admin
   * DELETE /users/:id). Refused (409 activeOrdersExist) while an order is
   * open as customer or cook. Then: anonymize + soft delete the user in one
   * UPDATE, clear the delivery-address copies on their orders, soft-delete
   * their reviews (scrubbed, ratings recomputed) and their kitchen's,
   * hard-delete their favorites and chat messages, take the menu and kitchen
   * off discovery, hard-delete their addresses (GPS) and end every session,
   * which also revokes outstanding access tokens (see JwtStrategy). Issue
   * reports stay (dispute record).
   */
  async remove(id: User['id']): Promise<void> {
    await this.ordersService.assertNoActiveOrders(id);
    await this.usersRepository.anonymizeAndSoftDelete(id);
    await this.ordersService.clearDeliveryAddresses(id);
    // Before the kitchen goes: its reviews are found through it.
    await this.reviewsService.removeForUser(id);
    await this.favoritesService.removeAllForUser(id);
    await this.orderMessagesService.removeAllForUser(id);
    await this.productsService.removeAllForOwner(id);
    await this.kitchensService.removeForOwner(id);
    await this.addressesService.removeAllForUser(id);
```

`src/users/users.module.ts` — şu bloğu:

```ts
import { KitchensModule } from '../kitchens/kitchens.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';

const infrastructurePersistenceModule = RelationalUserPersistenceModule;

```

şununla değiştir:

```ts
import { KitchensModule } from '../kitchens/kitchens.module';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { FavoritesModule } from '../favorites/favorites.module';
import { OrderMessagesModule } from '../order-messages/order-messages.module';

const infrastructurePersistenceModule = RelationalUserPersistenceModule;

```

`src/users/users.module.ts` — ardından şu bloğu:

```ts
    KitchensModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
```

şununla değiştir:

```ts
    KitchensModule,
    ProductsModule,
    OrdersModule,
    ReviewsModule,
    FavoritesModule,
    OrderMessagesModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
```

Run: `npx jest src/reviews src/users && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: PASS, tip hatası yok, lint temiz. Dev API logunda `Nest can't resolve dependencies` veya döngü uyarısı yok.

- [ ] **Step 4: e2e — hesap silme**

`test/user/trust-deletion.e2e-spec.ts` — dosyanın tamamı:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Cart,
  addProduct,
  categoryId,
  completeOrder,
  openKitchen,
  phoneLogin,
  randomSpot,
  setName,
  testDatabase,
  uniquePhone,
  uploadPhoto,
} from '../utils/orders';

describe('Account deletion of trust data', () => {
  const app = APP_URL;
  const db = testDatabase();
  let cook: string;
  let leaving: string;
  let staying: string;
  let leavingId: number;
  let kitchenId: string;
  let cart: Cart;
  let leavingOrder: string;
  let stayingReview: string;
  let issueId: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const deleteAccount = (token: string) =>
    request(app).delete('/api/v1/auth/me').auth(token, { type: 'bearer' });

  const storedRating = async () => {
    const [row] = await db.query(
      'SELECT "ratingAvg", "ratingCount" FROM "kitchen" WHERE "id" = $1',
      [kitchenId],
    );
    return row as { ratingAvg: number | null; ratingCount: number };
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90577'));
    leaving = await phoneLogin(uniquePhone('+90578'));
    staying = await phoneLogin(uniquePhone('+90579'));
    await setName(leaving, 'Gidecek', 'Müşteri');
    await setName(staying, 'Kalacak', 'Müşteri');
    leavingId = (await get('/auth/me', leaving).expect(200)).body.data.id;

    kitchenId = await openKitchen(cook, randomSpot());
    const productId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    cart = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId, quantity: 1 }],
    };

    leavingOrder = await completeOrder(cook, leaving, cart);
    const second = await completeOrder(cook, leaving, cart);
    const stayingOrder = await completeOrder(cook, staying, cart);

    await post(`/orders/${leavingOrder}/review`, leaving)
      .send({
        rating: 5,
        comment: 'Kişisel bir yorum',
        photoIds: [await uploadPhoto(leaving)],
      })
      .expect(201);
    await post(`/orders/${second}/review`, leaving)
      .send({ rating: 1 })
      .expect(201);
    stayingReview = (
      await post(`/orders/${stayingOrder}/review`, staying)
        .send({ rating: 4, comment: 'Güzeldi' })
        .expect(201)
    ).body.data.id;

    await post(`/kitchens/${kitchenId}/favorite`, leaving).expect(204);
    await post(`/orders/${leavingOrder}/messages`, leaving)
      .send({ body: 'Benim mesajım' })
      .expect(201);
    await post(`/kitchens/me/orders/${leavingOrder}/messages`, cook)
      .send({ body: 'Aşçının mesajı' })
      .expect(201);
    issueId = (
      await post(`/orders/${leavingOrder}/issues`, leaving)
        .send({
          category: 'missing_item',
          description: 'Bir kalem eksik geldi.',
          requestedResolution: 'none',
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should start from three counted reviews', async () => {
    expect(await storedRating()).toEqual({ ratingAvg: 3.3, ratingCount: 3 });
  });

  it('should scrub the customer’s reviews, recompute, drop favorites and messages, keep the issue', async () => {
    await deleteAccount(leaving).expect(204);

    expect(await storedRating()).toEqual({ ratingAvg: 4, ratingCount: 1 });

    const reviews = await db.query(
      'SELECT "deletedAt", "comment", "photos" FROM "review" WHERE "authorId" = $1',
      [leavingId],
    );
    expect(reviews).toHaveLength(2);
    for (const review of reviews) {
      expect(review.deletedAt).toBeInstanceOf(Date);
      expect(review.comment).toBeNull();
      expect(review.photos).toEqual([]);
    }

    const [{ favorites }] = await db.query(
      'SELECT COUNT(*)::int AS favorites FROM "favorite" WHERE "userId" = $1',
      [leavingId],
    );
    expect(favorites).toBe(0);

    const messages = await db.query(
      'SELECT "senderRole", "body" FROM "order_message" WHERE "orderId" = $1',
      [leavingOrder],
    );
    expect(messages).toEqual([{ senderRole: 'cook', body: 'Aşçının mesajı' }]);

    const [issue] = await db.query(
      'SELECT "status", "description" FROM "order_issue" WHERE "id" = $1',
      [issueId],
    );
    expect(issue).toEqual({
      status: 'open',
      description: 'Bir kalem eksik geldi.',
    });

    await get(`/discover/kitchens/${kitchenId}/reviews`, staying)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
          stayingReview,
        ]);
      });
  });

  it('should take the kitchen’s reviews and replies with the cook’s account', async () => {
    await request(app)
      .put(`/api/v1/kitchens/me/reviews/${stayingReview}/reply`)
      .auth(cook, { type: 'bearer' })
      .send({ reply: 'Teşekkürler!' })
      .expect(200);

    await deleteAccount(cook).expect(204);

    const [review] = await db.query(
      'SELECT "deletedAt", "reply", "repliedAt" FROM "review" WHERE "id" = $1',
      [stayingReview],
    );
    expect(review.deletedAt).toBeInstanceOf(Date);
    expect(review.reply).toBeNull();
    expect(review.repliedAt).toBeNull();
    expect(await storedRating()).toEqual({ ratingAvg: null, ratingCount: 0 });

    await get(`/discover/kitchens/${kitchenId}/reviews`, staying).expect(404);
  });
});
```

Run: `npm run test:e2e -- --runInBand test/user/trust-deletion.e2e-spec.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Geliştirme seed'i**

Faz 3 seed'inde tek tamamlanmış sipariş var; spec iki değerlendirme (biri yanıtlı, biri fotoğraflı) istediği için güven seed'i iki tamamlanmış sipariş daha ekler: dün Nuran Hanım'dan (fotoğraflı değerlendirme + açık sorun kaydı) ve üç saat önce Hatice Teyze'den (değerlendirme hatırlatmasını denemek için değerlendirilmemiş bırakılır). Bunun için `OrderSeedService`'in sipariş yazan metodu açılır. Seed fotoğrafı `./files/seed-review.png` olarak yazılır ve yükleme gibi `file` tablosuna kaydedilir. Seed müşterisinin değerlendirmesi varsa hiçbir şey yapmaz.

`src/database/seeds/relational/order/order-seed.service.ts` — şu bloğu:

```ts
const COORD_PRECISION = 3;
const MINUTE_MS = 60_000;

type SeedOrder = {
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** [product name, quantity] from the first seed kitchen's menu. */
  items: [string, number][];
  minutesAgo: number;
  cancelledBy?: CancelledBy;
```

şununla değiştir:

```ts
const COORD_PRECISION = 3;
const MINUTE_MS = 60_000;

export type SeedOrder = {
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** [product name, quantity] from the kitchen's menu. */
  items: [string, number][];
  minutesAgo: number;
  cancelledBy?: CancelledBy;
```

`src/database/seeds/relational/order/order-seed.service.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
    }

    const customer = await this.customer();
    const menu = await this.menuOf(kitchen);

    for (const seed of ORDERS) {
      await this.addOrder(seed, kitchen, customer, menu);
    }
  }

  /** The kitchen's products by name, for SeedOrder.items. */
  async menuOf(kitchen: KitchenEntity): Promise<Map<string, ProductEntity>> {
    return new Map(
      (await this.products.find({ where: { kitchenId: kitchen.id } })).map(
        (product) => [product.name, product],
      ),
    );
  }

  private async customer(): Promise<UserEntity> {
```

`src/database/seeds/relational/order/order-seed.service.ts` — ardından şu bloğu:

```ts
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
```

şununla değiştir:

```ts
    return customer;
  }

  /** One order with its items and payment, as if it had happened `minutesAgo`. */
  async addOrder(
    seed: SeedOrder,
    kitchen: KitchenEntity,
    customer: UserEntity,
    menu: Map<string, ProductEntity>,
  ): Promise<OrderEntity> {
    const createdAt = new Date(Date.now() - seed.minutesAgo * MINUTE_MS);
    const at = (minutes: number) =>
      new Date(createdAt.getTime() + minutes * MINUTE_MS);
```

`src/database/seeds/relational/order/order-seed.service.ts` — ardından dosyanın sonundaki şu bloğu:

```ts
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

şununla değiştir:

```ts
        provider: 'dev',
        providerRef: `dev_seed_${order.code}`,
        amountKurus: totalKurus,
        refundedKurus: closed ? totalKurus : 0,
        status: closed ? PaymentStatus.refunded : PaymentStatus.paid,
        paidAt: createdAt,
        refundedAt: closed ? at(3) : null,
      }),
    );

    return order;
  }
}
```

`src/database/seeds/relational/trust/trust-seed.service.ts` — dosyanın tamamı:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { In, Repository } from 'typeorm';
import { FileEntity } from '../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { FavoriteEntity } from '../../../../favorites/infrastructure/persistence/relational/entities/favorite.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderIssueEntity } from '../../../../order-issues/infrastructure/persistence/relational/entities/order-issue.entity';
import { OrderMessageEntity } from '../../../../order-messages/infrastructure/persistence/relational/entities/order-message.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { Fulfillment, OrderStatus } from '../../../../orders/order.enums';
import { ReviewEntity } from '../../../../reviews/infrastructure/persistence/relational/entities/review.entity';
import { ratingGroupsOf } from '../../../../reviews/infrastructure/persistence/relational/repositories/review.repository';
import { ratingSummary } from '../../../../trust/trust-rules';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
  MessageSide,
  ReviewTag,
} from '../../../../trust/trust.enums';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { OrderSeedService } from '../order/order-seed.service';

const COOK_PHONES = ['+905550000101', '+905550000102', '+905550000103'];
const CUSTOMER_PHONE = '+905550000201';
const MINUTE_MS = 60_000;

// 1×1 PNG, served by the local file driver like an upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PHOTO_NAME = 'seed-review.png';

/**
 * Development data only, on top of the order seed: reviews on completed
 * orders (one answered by the cook, one with a photo), two favorites, a
 * four-message chat on the order that is on its way, one open issue, and
 * the seed kitchens' ratings recomputed. Runs once (skips when the seed
 * customer has a review).
 */
@Injectable()
export class TrustSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(ReviewEntity)
    private readonly reviews: Repository<ReviewEntity>,
    @InjectRepository(FavoriteEntity)
    private readonly favorites: Repository<FavoriteEntity>,
    @InjectRepository(OrderMessageEntity)
    private readonly messages: Repository<OrderMessageEntity>,
    @InjectRepository(OrderIssueEntity)
    private readonly issues: Repository<OrderIssueEntity>,
    @InjectRepository(FileEntity)
    private readonly files: Repository<FileEntity>,
    private readonly orderSeed: OrderSeedService,
  ) {}

  async run() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const customer = await this.users.findOne({
      where: { phoneNumber: CUSTOMER_PHONE },
    });
    const cooks = await this.users.find({
      where: { phoneNumber: In(COOK_PHONES) },
    });
    const kitchens = await this.kitchens.find({
      where: { ownerId: In(cooks.map((cook) => cook.id)) },
    });
    const byPhone = (phone: string) => {
      const cook = cooks.find((user) => user.phoneNumber === phone);
      return kitchens.find((kitchen) => kitchen.ownerId === cook?.id);
    };
    const [ayse, nuran, hatice] = COOK_PHONES.map(byPhone);

    if (
      !customer ||
      !ayse ||
      !nuran ||
      !hatice ||
      (await this.reviews.exists({
        where: { authorId: customer.id },
        withDeleted: true,
      }))
    ) {
      return;
    }

    const completed = await this.orders.findOne({
      where: {
        kitchenId: ayse.id,
        customerId: customer.id,
        status: OrderStatus.completed,
      },
    });
    const onTheWay = await this.orders.findOne({
      where: {
        kitchenId: ayse.id,
        customerId: customer.id,
        status: OrderStatus.onTheWay,
      },
    });

    if (!completed || !onTheWay) {
      return;
    }

    // Yesterday at Nuran's (reviewed with a photo, issue open) and three hours
    // ago at Hatice's (left unreviewed for the review reminder).
    const sarma = await this.orderSeed.addOrder(
      {
        status: OrderStatus.completed,
        fulfillment: Fulfillment.pickup,
        items: [['Yaprak sarma', 2]],
        minutesAgo: 26 * 60,
      },
      nuran,
      customer,
      await this.orderSeed.menuOf(nuran),
    );
    await this.orderSeed.addOrder(
      {
        status: OrderStatus.completed,
        fulfillment: Fulfillment.delivery,
        items: [['Su böreği', 1]],
        minutesAgo: 3 * 60,
      },
      hatice,
      customer,
      await this.orderSeed.menuOf(hatice),
    );

    const photo = await this.photo();

    await this.reviews.save([
      this.reviews.create({
        orderId: completed.id,
        kitchenId: ayse.id,
        authorId: customer.id,
        rating: 5,
        taste: 5,
        portion: 5,
        packaging: null,
        timing: 4,
        tags: [ReviewTag.homemade, ReviewTag.generousPortion],
        comment: 'Annemin karnıyarığı gibi, porsiyon da doyurucu.',
        photos: [],
        reply: 'Afiyet olsun Deniz Hanım, yine bekleriz!',
        repliedAt: new Date(),
        isHidden: false,
      }),
      this.reviews.create({
        orderId: sarma.id,
        kitchenId: nuran.id,
        authorId: customer.id,
        rating: 4,
        taste: 5,
        portion: 3,
        packaging: 4,
        timing: null,
        tags: [ReviewTag.wellPackaged],
        comment: 'Sarmalar çok lezzetliydi, bir porsiyon eksik geldi.',
        photos: [{ id: photo.id, path: photo.path }],
        reply: null,
        repliedAt: null,
        isHidden: false,
      }),
    ]);

    await this.favorites.save([
      this.favorites.create({ userId: customer.id, kitchenId: ayse.id }),
      this.favorites.create({ userId: customer.id, kitchenId: hatice.id }),
    ]);

    await this.chat(onTheWay, customer, ayse.ownerId);

    await this.issues.save(
      this.issues.create({
        orderId: sarma.id,
        reporterId: customer.id,
        category: IssueCategory.missingItem,
        description: 'Siparişte 2 porsiyon sarma vardı, 1 porsiyon geldi.',
        photos: [],
        requestedResolution: IssueResolution.refundPartial,
        status: IssueStatus.open,
        refundKurus: null,
        adminNote: null,
        resolvedAt: null,
      }),
    );

    for (const kitchen of [ayse, nuran, hatice]) {
      const { ratingAvg, ratingCount } = ratingSummary(
        await ratingGroupsOf(this.reviews.manager, kitchen.id),
      );
      await this.kitchens.update(
        { id: kitchen.id },
        { ratingAvg, ratingCount },
      );
    }
  }

  /** Four messages; the cook's last one is still unread by the customer. */
  private async chat(
    order: OrderEntity,
    customer: UserEntity,
    cookId: number,
  ): Promise<void> {
    const start = Date.now() - 20 * MINUTE_MS;
    const lines: [MessageSide, string][] = [
      [
        MessageSide.customer,
        'Merhaba, zil bozuk; gelince buradan yazar mısınız?',
      ],
      [MessageSide.cook, 'Tabii, yola çıktım, 10 dakikaya oradayım.'],
      [MessageSide.customer, 'Teşekkürler, aşağı iniyorum.'],
      [MessageSide.cook, 'Kapıdayım.'],
    ];

    await this.messages.save(
      lines.map(([side, body], index) =>
        this.messages.create({
          orderId: order.id,
          senderId: side === MessageSide.customer ? customer.id : cookId,
          senderRole: side,
          body,
          createdAt: new Date(start + index * 5 * MINUTE_MS),
        }),
      ),
    );

    // Both read up to the third message.
    const readAt = new Date(start + 2 * 5 * MINUTE_MS + MINUTE_MS);
    await this.orders.update(
      { id: order.id },
      { customerLastReadAt: readAt, cookLastReadAt: readAt },
    );
  }

  /** A real file under ./files, registered like an upload. */
  private async photo(): Promise<FileEntity> {
    const directory = path.join(process.cwd(), 'files');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, PHOTO_NAME), PNG);

    return this.files.save(
      this.files.create({
        path: `/${process.env.API_PREFIX ?? 'api'}/v1/files/${PHOTO_NAME}`,
      }),
    );
  }
}
```

`src/database/seeds/relational/trust/trust-seed.module.ts` — dosyanın tamamı:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FavoriteEntity } from '../../../../favorites/infrastructure/persistence/relational/entities/favorite.entity';
import { FileEntity } from '../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderIssueEntity } from '../../../../order-issues/infrastructure/persistence/relational/entities/order-issue.entity';
import { OrderMessageEntity } from '../../../../order-messages/infrastructure/persistence/relational/entities/order-message.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { ReviewEntity } from '../../../../reviews/infrastructure/persistence/relational/entities/review.entity';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { OrderSeedModule } from '../order/order-seed.module';
import { TrustSeedService } from './trust-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      KitchenEntity,
      OrderEntity,
      ReviewEntity,
      FavoriteEntity,
      OrderMessageEntity,
      OrderIssueEntity,
      FileEntity,
    ]),
    OrderSeedModule,
  ],
  providers: [TrustSeedService],
  exports: [TrustSeedService],
})
export class TrustSeedModule {}
```

`src/database/seeds/relational/run-seed.ts` — şu bloğu:

```ts
import { RoleSeedService } from './role/role-seed.service';
import { SeedModule } from './seed.module';
import { StatusSeedService } from './status/status-seed.service';
import { UserSeedService } from './user/user-seed.service';

const runSeed = async () => {
```

şununla değiştir:

```ts
import { RoleSeedService } from './role/role-seed.service';
import { SeedModule } from './seed.module';
import { StatusSeedService } from './status/status-seed.service';
import { TrustSeedService } from './trust/trust-seed.service';
import { UserSeedService } from './user/user-seed.service';

const runSeed = async () => {
```

`src/database/seeds/relational/run-seed.ts` — ardından şu bloğu:

```ts
  await app.get(CategorySeedService).run();
  await app.get(KitchenSeedService).run();
  await app.get(OrderSeedService).run();

  await app.close();
};
```

şununla değiştir:

```ts
  await app.get(CategorySeedService).run();
  await app.get(KitchenSeedService).run();
  await app.get(OrderSeedService).run();
  await app.get(TrustSeedService).run();

  await app.close();
};
```

`src/database/seeds/relational/seed.module.ts` — şu bloğu:

```ts
import { OrderSeedModule } from './order/order-seed.module';
import { RoleSeedModule } from './role/role-seed.module';
import { StatusSeedModule } from './status/status-seed.module';
import { UserSeedModule } from './user/user-seed.module';
import databaseConfig from '../../config/database.config';
import appConfig from '../../../config/app.config';
```

şununla değiştir:

```ts
import { OrderSeedModule } from './order/order-seed.module';
import { RoleSeedModule } from './role/role-seed.module';
import { StatusSeedModule } from './status/status-seed.module';
import { TrustSeedModule } from './trust/trust-seed.module';
import { UserSeedModule } from './user/user-seed.module';
import databaseConfig from '../../config/database.config';
import appConfig from '../../../config/app.config';
```

`src/database/seeds/relational/seed.module.ts` — ardından şu bloğu:

```ts
    CategorySeedModule,
    KitchenSeedModule,
    OrderSeedModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, appConfig],
```

şununla değiştir:

```ts
    CategorySeedModule,
    KitchenSeedModule,
    OrderSeedModule,
    TrustSeedModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, appConfig],
```

```bash
npm run seed:run:relational
PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2-) psql -h localhost -U sofram -d sofram \
  -c "SELECT k.name, k.\"ratingAvg\", k.\"ratingCount\" FROM kitchen k JOIN \"user\" u ON u.id = k.\"ownerId\" WHERE u.\"phoneNumber\" LIKE '+90555000010%' ORDER BY u.\"phoneNumber\"" \
  -c "SELECT r.rating, r.reply IS NOT NULL AS replied, jsonb_array_length(r.photos) AS photos FROM review r JOIN \"user\" u ON u.id = r.\"authorId\" WHERE u.\"phoneNumber\" = '+905550000201'" \
  -c "SELECT i.category, i.status FROM order_issue i JOIN \"user\" u ON u.id = i.\"reporterId\" WHERE u.\"phoneNumber\" = '+905550000201'"
npm run seed:run:relational
```

Expected: mutfak puanları Ayşe Teyze `5 | 1`, Nuran Hanım `4 | 1`, Hatice Teyze boş `| 0`; iki değerlendirme (`5 | t | 0`, `4 | f | 1`); bir `missing_item | open` kaydı. İkinci seed çalıştırması yeni satır eklemez. `dev:+905550000201` ile girişte `GET /orders?scope=active` yoldaki siparişte `unreadMessages: 1`, `GET /orders?scope=past` Hatice Teyze siparişinde `canReview: true`, `GET /favorites?lat=40.99&lng=29.03` iki mutfak döner.

- [ ] **Step 6: `CLAUDE.md`**

`CLAUDE.md` — şu bloğu:

```markdown
- Every response is wrapped by `utils/http/ResponseEnvelopeInterceptor` as `{ data, status, statusCode, message }`; errors go through `utils/http/AllExceptionsFilter` as `{ data: null, status: false, statusCode, message, errors?: { field, message }[] }` (dot paths for nested DTOs). 204 is not wrapped. Keep throwing the boilerplate shape (`new UnprocessableEntityException({ status, errors: { field: 'key' } })`) — the filter flattens it.
- Records that belong to a user are looked up scoped to that user and wrapped in `orNotFound(...)` (`utils/or-not-found.ts`): someone else's record is a 404, never a 403.
- Phone login: the client sends a phone-auth `idToken` to `POST /api/v1/auth/phone/login`; `auth-phone/verifier/PhoneTokenVerifier` turns it into an E.164 number. Only `DevPhoneTokenVerifier` exists (accepts `dev:+905551112233`) and it is opt-in: it is bound only when `AUTH_PHONE_DEV_VERIFIER=true` (local `.env`, e2e; never in production, where the app refuses to boot with it). Without the flag the app refuses to boot until a Firebase verifier is returned from `phone-token-verifier.provider.ts` — fail-closed, never inferred from `NODE_ENV`.
- Account deletion (`DELETE /auth/me`, admin `DELETE /users/:id`) goes only through `UsersService.remove`. It is refused with 409 `activeOrdersExist` while the user has an open order as customer or as cook (overdue pending orders are expired first). Then one UPDATE anonymizes the user (phone → `deleted:<id>`, email/names/photo/socialId → null, `allergenPreferences` cleared) and soft-deletes it, the `deliveryAddress` copies on their orders are cleared, the user's products are soft-deleted and the kitchen is scrubbed (name, description, cover, address, coordinates, search text) and soft-deleted in one UPDATE — it is a copy of a hard-deleted address (so the menu and kitchen disappear from `/discover/*`), then addresses are hard-deleted and sessions ended — in that order: anonymize → order addresses → products → kitchen → addresses → sessions. Closed orders stay (anonymized parties). `JwtStrategy` checks the session on every request, so logout and deletion revoke access tokens immediately.
- `profileCompleted` is derived in `UserMapper.toDomain` (first name + last name + KVKK consent) — never store it.
- Phase specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
- Catalog (Faz 2): one kitchen per user (`/kitchens/me`), its menu under `/kitchens/me/products`; customers read through `/discover/*` only. Kitchen address is a copy of an address-book entry; customers get coordinates rounded to `DISCOVERY_COORD_PRECISION`, never `fullAddress`, and customer-facing distance, pickup/delivery availability and fee are measured from that rounded point (so probing lat/lng cannot recover the exact location). Delivery tiers and weekly hours are jsonb on `kitchen`; `deliveryRadiusKm` and every `searchText` are derived on write — never set them by hand.
```

şununla değiştir:

```markdown
- Every response is wrapped by `utils/http/ResponseEnvelopeInterceptor` as `{ data, status, statusCode, message }`; errors go through `utils/http/AllExceptionsFilter` as `{ data: null, status: false, statusCode, message, errors?: { field, message }[] }` (dot paths for nested DTOs). 204 is not wrapped. Keep throwing the boilerplate shape (`new UnprocessableEntityException({ status, errors: { field: 'key' } })`) — the filter flattens it.
- Records that belong to a user are looked up scoped to that user and wrapped in `orNotFound(...)` (`utils/or-not-found.ts`): someone else's record is a 404, never a 403.
- Phone login: the client sends a phone-auth `idToken` to `POST /api/v1/auth/phone/login`; `auth-phone/verifier/PhoneTokenVerifier` turns it into an E.164 number. Only `DevPhoneTokenVerifier` exists (accepts `dev:+905551112233`) and it is opt-in: it is bound only when `AUTH_PHONE_DEV_VERIFIER=true` (local `.env`, e2e; never in production, where the app refuses to boot with it). Without the flag the app refuses to boot until a Firebase verifier is returned from `phone-token-verifier.provider.ts` — fail-closed, never inferred from `NODE_ENV`.
- Account deletion (`DELETE /auth/me`, admin `DELETE /users/:id`) goes only through `UsersService.remove`. It is refused with 409 `activeOrdersExist` while the user has an open order as customer or as cook (overdue pending orders are expired first). Then one UPDATE anonymizes the user (phone → `deleted:<id>`, email/names/photo/socialId → null, `allergenPreferences` cleared) and soft-deletes it, the `deliveryAddress` copies on their orders are cleared, their reviews are soft-deleted with comment and photos scrubbed (kitchen ratings recomputed) and, for a cook, the kitchen's reviews are soft-deleted with replies scrubbed, their favorites and the chat messages they wrote are hard-deleted, the user's products are soft-deleted and the kitchen is scrubbed (name, description, cover, address, coordinates, search text) and soft-deleted in one UPDATE — it is a copy of a hard-deleted address (so the menu and kitchen disappear from `/discover/*`), then addresses are hard-deleted and sessions ended — in that order: anonymize → order addresses → reviews → favorites → messages → products → kitchen → addresses → sessions. Closed orders and issue reports stay (anonymized parties). `JwtStrategy` checks the session on every request, so logout and deletion revoke access tokens immediately.
- `profileCompleted` is derived in `UserMapper.toDomain` (first name + last name + KVKK consent) — never store it.
- Phase specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
- Catalog (Faz 2): one kitchen per user (`/kitchens/me`), its menu under `/kitchens/me/products`; customers read through `/discover/*` only. Kitchen address is a copy of an address-book entry; customers get coordinates rounded to `DISCOVERY_COORD_PRECISION`, never `fullAddress`, and customer-facing distance, pickup/delivery availability and fee are measured from that rounded point (so probing lat/lng cannot recover the exact location). Delivery tiers and weekly hours are jsonb on `kitchen`; `deliveryRadiusKm` and every `searchText` are derived on write — never set them by hand.
```

`CLAUDE.md` — ardından dosyanın sonundaki şu bloğu:

```markdown
- Order privacy: the cook sees the customer as "Ad S." and the delivery address, never the phone or the pickup code; the customer gets the kitchen's exact address only for pickup orders in `accepted`, `preparing` or `ready`.
- Payments sit behind `payments/provider/PaymentProvider`; only `DevPaymentProvider` exists (`PAYMENT_PROVIDER=dev`). `DEV_PAYMENT_FAIL=true` declines every charge (ignored in production). `test/user/order-payment.e2e-spec.ts` runs only against an API started with that flag.
- Pending orders expire after `ORDER_ACCEPT_MINUTES` (3): `OrdersExpiryTask` sweeps every 30 s (`@nestjs/schedule`) and also deletes `order_request` rows older than 24 h; every order read expires its own overdue orders first. Service fee is `ORDER_SERVICE_FEE_PERCENT` (5) of the subtotal, delivery orders add `ORDER_DELIVERY_BUFFER_MINUTES` (15) to the estimate. Order times are `timestamptz`; "today"/"this week" are Istanbul (`orders/order-time.ts`).
- Dev seed (`npm run seed:run:relational`) adds categories everywhere and, outside production, three Kadıköy kitchens whose cooks log in with `dev:+905550000101..103` (the third has a ₺150 minimum, the first free delivery from ₺300), and a customer `dev:+905550000201` with one order in every status but pending at the first kitchen.
```

şununla değiştir:

```markdown
- Order privacy: the cook sees the customer as "Ad S." and the delivery address, never the phone or the pickup code; the customer gets the kitchen's exact address only for pickup orders in `accepted`, `preparing` or `ready`.
- Payments sit behind `payments/provider/PaymentProvider`; only `DevPaymentProvider` exists (`PAYMENT_PROVIDER=dev`). `DEV_PAYMENT_FAIL=true` declines every charge (ignored in production). `test/user/order-payment.e2e-spec.ts` runs only against an API started with that flag.
- Pending orders expire after `ORDER_ACCEPT_MINUTES` (3): `OrdersExpiryTask` sweeps every 30 s (`@nestjs/schedule`) and also deletes `order_request` rows older than 24 h; every order read expires its own overdue orders first. Service fee is `ORDER_SERVICE_FEE_PERCENT` (5) of the subtotal, delivery orders add `ORDER_DELIVERY_BUFFER_MINUTES` (15) to the estimate. Order times are `timestamptz`; "today"/"this week" are Istanbul (`orders/order-time.ts`).
- Trust (Faz 4): rules are pure in `trust/trust-rules.ts` (`canReview` 7 days after completion, once — a deleted review still counts; `canReportIssue` 48 h after completion or a cook's cancellation, or a delivery on the way for over 2 h, one open report per order; `canMessage` while open and 24 h after closing; `ratingSummary`; `unreadRule`), windows in `trust.*` config (`REVIEW_WINDOW_DAYS`, `ISSUE_WINDOW_HOURS`, `MESSAGING_WINDOW_HOURS`, `SUPPORT_EMAIL`). `kitchen.ratingAvg`/`ratingCount` are derived: every review write that changes what counts (create, delete, hide) locks the kitchen row and recomputes them in the same transaction (`ReviewRelationalRepository`); `PATCH /kitchens/me` never writes them. Hidden and deleted reviews never count.
- Reviews: `POST /orders/:id/review`, `DELETE /reviews/:id`, `GET /discover/kitchens/:id/reviews` (with `summary`); cook `/kitchens/me/reviews` (`?filter=all|unreplied`, `PUT|DELETE /:id/reply`, `POST /:id/report`). Favorites (kitchens only): `POST|DELETE /kitchens/:id/favorite` (idempotent, 204), `GET /favorites?lat&lng` as discovery `KitchenCard`s; every `KitchenCard` carries `isFavorite`, `ratingAvg`, `ratingCount`. Issues: `POST /orders/:id/issues` mails `SUPPORT_EMAIL`. Chat: `GET|POST /orders/:id/messages` and `/kitchens/me/orders/:id/messages` (`?after=` the last `createdAt`, at most 100, oldest first; reading moves `customerLastReadAt`/`cookLastReadAt`). Order detail/list/summary carry `review`, `issue`, `canReview`, `canReportIssue`, `unreadMessages`, `canMessage`, `rating`, `unrepliedReviews` (`orders/order-trust.service.ts`).
- Admin (Swagger, `RoleEnum.admin`): `GET /admin/review-reports`, `PATCH /admin/reviews/:id {isHidden}`, `GET /admin/issues?status`, `PATCH /admin/issues/:id` — resolving with `refundKurus` goes through `PaymentsService.refundPartial` inside the issue's locked transaction; refunds add up in `payment.refundedKurus` (422 `refundKurus: exceedsPaid` past the paid amount; reaching it makes the payment `refunded`).
- Dev seed (`npm run seed:run:relational`) adds categories everywhere and, outside production, three Kadıköy kitchens whose cooks log in with `dev:+905550000101..103` (the third has a ₺150 minimum, the first free delivery from ₺300), a customer `dev:+905550000201` with one order in every status but pending at the first kitchen, and trust data: reviews on two completed orders (one answered, one with a photo), a third completed order left to review, two favorites, a four-message chat on the order on its way, one open issue, ratings recomputed.
```

- [ ] **Step 7: Son doğrulama**

```bash
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
npm run test:e2e -- --runInBand
```

Expected: lint temiz, tip hatası yok, birim ve e2e PASS (`order-payment` dosyası atlanır). Ardından Faz 3 planının (`docs/superpowers/plans/2026-10-18-faz3-backend.md`) Task 5 Step 13'teki komutlarıyla `DEV_PAYMENT_FAIL=true` API'sine karşı `test/user/order-payment.e2e-spec.ts` → 1 PASS; 3002'deki süreci kapat.

Swagger'da (`http://localhost:3001/docs`) `Reviews`, `Kitchen reviews`, `Favorites`, `Admin` etiketleri; `Orders` altında `/orders/{id}/issues` ve `/orders/{id}/messages`; `Kitchen orders` altında `/kitchens/me/orders/{id}/messages` görünür. API logunda `Duplicate DTO detected` yok.

- [ ] **Step 8: Commit**

```bash
git add src/reviews src/favorites src/order-messages src/users src/database/seeds test/user/trust-deletion.e2e-spec.ts CLAUDE.md
git commit -m "feat(users): remove reviews, favorites and messages with the account; seed trust data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Uygulama notları (plan yazılırken verilen kararlar — spec'i bu noktalarda netleştirir)

| Spec'teki | Uygulanan | Neden |
|---|---|---|
| Görev önerisi: Task 2 "şema" + özellik görevleri | Task 2 yalnız entity, domain, mapper, migration ve mevcut tabloların yeni alanları; repository'ler özellik görevlerinde | Her SQL, onu kanıtlayan e2e ile aynı görevde; Task 2 tek başına derlenir ve mevcut paketi bozmaz. |
| — | Hata anahtarları (`trust-errors.ts`) ve fotoğraf doğrulaması (`photosByIds`) Task 1'de | Değerlendirme ve sorun görevleri ikisini de kullanır; çekirdekte tek yer. |
| — | Ortak saf parçalar `src/trust/` altında (enum'lar, kurallar, hatalar, config) | Dört özellik modülü aynı kuralları ve pencereleri paylaşır. |
| `review_report` ayrı entity | Generator'la üretilir, entity `src/reviews/…/entities/`'e taşınır, iskelet silinir | Yalnız değerlendirme modülü okur/yazar (Faz 3 `order_item` emsali). |
| `favorite` entity | Domain sınıfı ve mapper yok; repository `Kitchen` döner | Favorinin kendi alanı yok; liste doğrudan keşif kartı. |
| Yapılandırma | `trust` namespace'i; pencereler 1–90 gün / 1–720 saat aralığında, `SUPPORT_EMAIL` zorunlu (varsayılan yok) | Faz 3 config deseni; destek adresi olmadan sorun maili gidecek yer yok. |
| `canReview(order, now)` vb. | `canReview(order, hasReview, now, windowDays)`, `canReportIssue(order, hasOpenIssue, now, windowHours)`, `canMessage(order, now, windowHours)` | Saf fonksiyon veritabanına bakamaz; olgular ve pencere parametre. Sınırda (tam 7 gün / 48 / 24 saat) pencere kapalı. |
| Takılı teslimat "2 saat" | Sabit `STUCK_DELIVERY_HOURS = 2`, `onTheWayAt + 2 saat < now` (tam 2 saatte henüz değil) | Spec bunu config'e koymuyor. |
| `ratingSummary(reviews)` | `ratingSummary(groups)`: SQL `GROUP BY rating, isHidden, deletedAt IS NOT NULL` satırları; gizli/silinmiş eleme ve yuvarlama fonksiyonda; aynı fonksiyon mutfak puanını ve yorum özetini (`distribution`) üretir | Tüm değerlendirmeleri belleğe çekmeden, kuralı birim testte tutarak. |
| `topTags[]` | En sık seçilen en çok 3 etiket; eşitlikte `ReviewTag` sırası; gizli/silinmiş hariç | Spec sayı ve sıra vermiyor. |
| Puan "aynı transaction'da yeniden hesaplanır" | Oluştur/sil/gizle önce mutfak satırını `FOR UPDATE` kilitler | READ COMMITTED'da eşzamanlı iki değerlendirme birbirini görmeden sayardı. |
| `kitchen.ratingAvg/ratingCount` | `KitchenRepository.update` ikisini hiç yazmaz; `create` almaz; `GET /kitchens/me` de gösterir | `PATCH /kitchens/me` mutfağın tamamını geri kaydediyor; eski kopya yeni puanı ezerdi. |
| "Değerlendirme yok" | Silinmiş değerlendirme de sayılır: silinen siparişe yeniden değerlendirme 409 `reviewExists` | "Düzenlenemez" kuralı sil-yeniden yaz ile delinmesin; `orderId` unique soft-delete'li satırı da kapsar. |
| Gövde `photos?` (dosya id'leri) | Alan adı `photoIds` (değerlendirme ve sorun) | Faz 2 ürün formu `photoIds`; mobil `PhotoField` aynı sözleşmeyi kullanır. |
| Yanıt şekilleri | `OrderReviewView` (müşterinin kendi değerlendirmesi, sipariş detayında da), `ReviewView` (+ `authorName` "Ad S.", `authorPhoto`), `KitchenReviewView` (+ `orderId`, `kitchenId`, `isHidden`); müşteri kendi gizlenmiş değerlendirmesini sipariş detayında görmeye devam eder | Yazar adı yalnız herkese açık listede gerekli; aşçı siparişe bağlantı ister. |
| Bildirim yanıtı | `POST …/report` 204 | Gösterilecek bir şey yok; ikinci kez 409. |
| `filter=unreplied` | Gizliler dahil; özet `unrepliedReviews` aynı tanımla sayar | Liste ile rozet sayısı tutarlı. |
| "Görünür olmayan mutfak 404" (favori, yorum listesi) | Mutfak yok ya da silinmiş → 404; duraklatılmış serbest; konuma bakılmaz | Bu uçlarda müşteri noktası yok (yorum listesi, favori ekle/çıkar). |
| `GET /favorites` | Uzaklık filtresi yok; mesafe ve `pickupAvailable`/`deliveryAvailable` verilen noktadan (yuvarlanmış mutfak noktasına); sayfalama `page/limit` | Taşınan müşteri favorisini kaybetmesin; Faz 2 §8 gizliliği korunur. |
| Kart alanları | `KitchenCard.isFavorite` eklendi (keşif listesi, detay, ürün detayındaki mutfak, favoriler); `ratingAvg/ratingCount` `KitchenSummary`'de (ürün kartının mutfağı dahil) | Spec kalbi istiyor ama durumunu döndüren alan yoktu; spec puanı "kart, özet ve detay"a koyuyor. |
| Sorun 409 | Eşzamanlı ikinci açık kayıt kısmi unique index ihlaliyle yine `issueNotAllowed` | Yarışta da tek açık kayıt. |
| Admin `PATCH /admin/issues/:id` | Karara bağlanmış kayıt **409 `issueClosed`** (yeni); `rejected` + `refundKurus` → 422 `refundKurus: onlyWhenResolved`; aşan iade 422 `refundKurus: exceedsPaid`; `paid` olmayan ödeme (tam iade edilmiş, `refund_failed`) de `exceedsPaid`; sağlayıcı reddi **502 `refundFailed`** (yeni) | Spec bu durumları tanımlamıyor; aynı kaydın iki kez iade üretmesini önler. |
| İade "PaymentsService üzerinden" | Sorun satırı kilitliyken `PaymentsService.refundPartial` çalışır (ödeme satırı kilitli, sağlayıcı transaction içinde); iade 422/502 olursa sorun açık kalır | Çift karar → çift iade olmaz; iade başarısızsa karar yazılmaz. |
| Tam iade | Kısmi iadeden sonraki tam iade kalanı verir ve `refundedKurus = amountKurus` yazar; tam tutara ulaşan kısmi iade `refunded` yapar | Spec "tam iade amountKurus'a eşitler", "toplam geçemez". |
| Migration "elle yazılmaz" | `CreateTrust` üretilir, `up()` sonuna tek satır veri düzeltmesi eklenir: `refunded` ödemelerde `refundedKurus = amountKurus` | Faz 3'te iade edilen ödemeler yeni sütunda 0 görünmesin. |
| Destek maili | Kayıttan sonra gönderilir; hata loglanır, istek 201 kalır; metin Türkçe sabit, kategori/çözüm enum değeriyle; `issue-reported.hbs` | Mail sunucusu sorunu müşterinin bildirimini düşürmesin. |
| `GET /admin/issues?status` | Sayfalı, en yeni üstte, `order { id, code, kitchenId, totalKurus }` ile; `GET /admin/review-reports` de sayfalı, silinmiş değerlendirmelerin bildirimleri hariç | Admin sipariş detayını müşteri uçlarından okuyamaz. |
| Sipariş detayında `issue` | Son kayıt, iki tarafa aynı özet: `id, category, requestedResolution, status, refundKurus, adminNote, createdAt, resolvedAt` (açıklama/fotoğraf yok) | Spec müşteriye "kategori, durum, refundKurus, adminNote", aşçıya "salt okunur" diyor. |
| Mesaj listesi | `GET …/messages` → `{ data, canMessage }`; `after` yoksa ilk 100, varsa sonrası (kesin büyük), en eski üstte; `createdAt timestamptz(3)` | Sohbet ekranı kapanış notu için detayı ayrıca çekmesin; JSON milisaniye taşıdığı için `after` tekrar döndürmesin. |
| Okuma işareti | `now` önce alınır, işaret yazılır, sonra okunur; gönderim işareti değiştirmez | Arada gelen mesaj kaybolmasın; spec yalnız okumayı sayar. |
| Okunmamış sayısı | Saf `unreadRule(viewer)` (karşı tarafın, işaretten sonraki mesajları) + SQL karşılığı tek sorguda sayfa için | Spec'in birim testi kuralı test eder; liste N+1 sorgu yapmaz. |
| `GET /kitchens/me/orders` kartları | `unreadMessages` eklendi | Mobil §3.2 "kartlarda okunmamış mesaj rozeti"; spec §2.3 yalnız detay/özeti sayıyor. |
| Özet `unreadMessages` | Mutfağın tüm siparişlerindeki okunmamış müşteri mesajları | Spec kapsamı belirtmiyor; 24 saat sonra yazılamasa da okunmamış kalan görünür. |
| Hesap silme | Değerlendirme soft-delete'te yorum ve fotoğraflar temizlenir (müşterinin kendi `DELETE /reviews/:id`'si düz soft-delete); aşçının mutfak değerlendirmeleri soft-delete + yanıt temizliği; `review_report` satırları kalır; silinmiş mutfağa işaret eden başka kullanıcıların favori satırları kalır ama listede görünmez | KVKK gerekçesi (spec §1) ve Faz 2 mutfak temizliği emsali; favori listesi zaten silinmiş mutfağı eler. |
| Zincir sırası | Değerlendirmeler ürün/mutfaktan önce | Aşçının mutfağı `findByOwner` ile bulunur; soft-delete'ten sonra bulunamaz. |
| Seed "Faz 3 seed'inin tamamlanmış siparişlerine" | Faz 3 seed'inde tek tamamlanmış sipariş var: iki tamamlanmış sipariş daha eklenir (Nuran Hanım dün: fotoğraflı değerlendirme + açık sorun; Hatice Teyze 3 saat önce: değerlendirilmemiş, hatırlatma için); sohbet yoldaki siparişte, müşteride 1 okunmamış; iade edilmiş seed ödemelerinde `refundedKurus = totalKurus`; tekrar çalıştırmada değişmez | Spec iki değerlendirme istiyor; bitti tanımı 6 (hatırlatma) seed'le denenebilsin. |
| e2e "akışa eklenir" | Özellik başına dosya (`reviews`, `favorites`, `order-issues`, `order-messages`, `trust-deletion`) + `test/utils/orders.ts`'e `uploadPhoto`, `adminLogin`, `placeOrder`, `cookStep`, `completeOrder`; Faz 3 `orders` e2e'sinin özet beklentisi güncellenir | Her dosya kendi aşçı/müşteri/mutfağını kurar; görevler bağımsız doğrulanır. |
| Swagger şema adları | Sorun görünümleri `IssueSummaryView`, `IssueView`, `AdminIssueView` | Faz 3'ün teklif görünümü `OrderIssueView` ile çakışma ("Duplicate DTO detected"). |
| Sayfalama DTO'su | Faz 3'ün `PageQueryDto`'su export edilip değerlendirme, admin ve favori listelerinde kullanılır (`IntersectionType(PointQueryDto, PageQueryDto)`) | Tek sayfalama kuralı (Faz 2 §8). |
