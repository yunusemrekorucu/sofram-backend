# Faz 3 — Sipariş (sepet, ödeme, durum makinesi, takip, aşçı siparişleri)

- **Tarih:** 2026-10-18
- **Kaynak gereksinim:** `Sofram: UI/UX Notları` (README) §2 (takip çubuğu, aşçı sekmeleri), §4.5–4.9, §5.2, §6, §8
- **Önceki fazlar:** [`2026-09-30-faz1-temel-design.md`](2026-09-30-faz1-temel-design.md), [`2026-10-15-faz2-katalog-design.md`](2026-10-15-faz2-katalog-design.md) — ikisinin §8 düzeltmeleri dahil, bu spec onları değiştirmez.
- **Repolar:** `sofram-backend`, `sofram-mobile`. API sözleşmesinin sahibi backend olduğu için spec burada durur.

## 1. Alınan kararlar

| Karar | Gerekçe |
|---|---|
| Ödeme **`PaymentProvider` arayüzü** arkasında; Faz 3'te yalnız **dev implementasyonu** (`charge` her zaman başarılı; `DEV_PAYMENT_FAIL=true` iken `paymentFailed`). Tahsilat sipariş anında, iade ret/iptal/süre dolmasında. | Faz 1'deki `PhoneTokenVerifier` deseni. Pazaryeri ödemesi aşçı alt üye işyeri kaydı (IBAN/kimlik) ister — o Faz 5. Gerçek sağlayıcıya geçiş tek sınıf. |
| Sipariş yalnız **"en kısa sürede"**; mutfak şu an açık ve duraklatılmamışken verilir. İleri saatli sipariş yok. | Günlük porsiyon "bugün"e ait; planlı siparişin stok ve kabul kuralları bu fazı büyütür. |
| **Sepet istemcide** (redux-persist, tek mutfak). Tutarlar sunucuda: `POST /orders/quote` teklif verir, `POST /orders` aynı hesabı yeniden yapar. | Fiyat ve stok kuralı tek yerde; her "sepete ekle" bir istek olmaz. Çoklu cihaz sepeti gerekirse sonradan sunucu sepeti eklenir. |
| `daily_portion` porsiyonu **sipariş anında** koşullu düşülür (`portionsAvailable >= adet`); ret/iptal/süre dolmasında geri eklenir. | Son porsiyonu iki müşteri aynı anda alamaz; aşçı stok yüzünden reddetmek zorunda kalmaz. |
| **Kabul süresi:** `pending` sipariş `ORDER_ACCEPT_MINUTES` (varsayılan 3) içinde yanıtlanmazsa `expired`. `@nestjs/schedule` 30 sn'de bir tarar; okuma anında da süre kontrol edilir. | README §5.2 "3:00 içinde yanıtla". Okumada kontrol, taramanın gecikmesini ekrana yansıtmaz. |
| **Hizmet bedeli** platform ayarı: `ORDER_SERVICE_FEE_PERCENT` (varsayılan 5) ara toplama uygulanır, kuruşa yuvarlanır (`Math.round`); müşteri öder, aşçıya yansımaz. | Mutfak başına komisyon/hakediş Faz 5. |
| **Minimum sipariş tutarı** mutfak başına (`minOrderKurus`, nullable); ara toplam altındaysa sipariş verilemez. **Ücretsiz teslimat eşiği** (`freeDeliveryMinKurus`, Faz 2) ara toplama göre uygulanır. | README §4.6 "₺40 daha ekle". |
| **Gel-al teslim kodu:** 4 haneli `pickupCode`; yalnız müşteriye döner, aşçı tamamlarken girer. Teslimatta kod yok. | README §4.8, §5.2. |
| **Mutfak tam adresi** müşteriye yalnız gel-al siparişi `accepted`, `preparing` veya `ready` iken döner. | Faz 2 §1: adres onaylı gel-al siparişinde açılır; sipariş kapanınca yeniden gizlenir. |
| Aşçı müşterinin **adını** ve (teslimatta) **teslimat adresini** görür; **telefon görmez**. | Numara gizli (README §6); mesajlaşma Faz 4. |
| **Canlılık:** Faz 6'ya kadar sorgulama (polling). Push, ses, websocket yok. | Faz 1 yol haritası: canlı güncelleme Faz 6. |
| Ürün seçenekleri/ekstralar ve kupon **yok**; ürün notu ve sipariş notu **var**. | Kapsam kararı. |

## 2. Backend

Tüm yeni entity'ler `generate` skill'iyle (hygen) üretilir; sahiplik `orNotFound(...)`, yanıtlar Faz 1 zarfıyla. Tüm endpoint'ler JWT ister. Tutarlar her yerde **kuruş** (int).

### 2.1 Durum makinesi

```
pending ──accept──▶ accepted ──start──▶ preparing ──ready──▶ ready ─┬─ (delivery) dispatch ─▶ on_the_way ─ complete ─▶ completed
   │                   │                    │                        └─ (pickup) complete {pickupCode} ───────────────▶ completed
   │                   └──── cook cancel {reason} ───┴──▶ cancelled (cancelledBy: cook)
   ├─ customer cancel ─▶ cancelled (cancelledBy: customer)
   ├─ reject {reason} ─▶ rejected
   └─ süre doldu ─────▶ expired (cancelledBy: system)
```

- **Aktif durumlar:** `pending`, `accepted`, `preparing`, `ready`, `on_the_way`. **Kapalı:** `completed`, `rejected`, `cancelled`, `expired`.
- Müşteri yalnız `pending` iptal eder. Aşçı `pending`'i reddeder; `accepted` veya `preparing`'i sebeple iptal eder. `ready` sonrası iptal yok.
- `dispatch` yalnız `delivery`, kodlu `complete` yalnız `pickup` siparişinde; `on_the_way → completed` kodsuz.
- **Sebepler** (`OrderReason` enum): `out_of_ingredients`, `too_busy`, `time_not_suitable`, `other`. `reject` ve aşçı `cancel` için zorunlu; müşteri iptali ve süre dolmasında null.
- **Kapanışta geri alma** (`rejected`, `cancelled`, `expired`): tek transaction'da durum + `closedAt` yazılır, `daily_portion` kalemlerinin adedi ürüne geri eklenir (ürün silinmişse atlanır), sonra `PaymentProvider.refund`. İade hata verirse `payment.status = refund_failed`, loglanır; sipariş durumu yine değişir.
- Her geçiş `UPDATE … WHERE id = :id AND status IN (:beklenen)` ile yapılır; etkilenen satır 0 ise **409 `orderStatusConflict`** (yarış: aşçı kabul ederken müşteri iptal etti, süre doldu).
- **Tahmini hazır olma:** `estimatedReadyAt = acceptedAt + max(kalemlerin prepMinutes, daily_portion için 0) + (delivery ise ORDER_DELIVERY_BUFFER_MINUTES, varsayılan 15)`. Kabulden önce teklif ve detay aynı formülü `now` ile `estimatedMinutes` olarak verir.

### 2.2 Veri modeli

**`order`**

| Alan | Tip | Not |
|---|---|---|
| `id` | uuid | |
| `code` | varchar(6), unique | Gösterim kodu `S-7K3F` biçiminde: `S-` + 4 karakter (karışmayan harf/rakam kümesi); çakışmada yeniden üretilir |
| `customerId` | FK user | |
| `kitchenId` | FK kitchen | |
| `status` | enum (§2.1) | index (`kitchenId`, `status`), (`customerId`, `status`) |
| `fulfillment` | enum `pickup` \| `delivery` | |
| `deliveryAddress` | jsonb, nullable | Teslimatta adres defterinden kopya: `fullAddress`, `district`, `neighborhood`, `buildingNo`, `floor`, `apartmentNo`, `directions`, `latitude`, `longitude`. Adres sonra silinse de kalır |
| `distanceKm` | numeric, nullable | Teslimatta, Faz 2 §8'deki yuvarlanmış mutfak noktasından |
| `note` | varchar(300), nullable | Sipariş notu |
| `subtotalKurus`, `deliveryFeeKurus`, `serviceFeeKurus`, `totalKurus` | int | |
| `pickupCode` | char(4), nullable | Yalnız `pickup` |
| `expiresAt` | timestamptz | `createdAt + ORDER_ACCEPT_MINUTES` |
| `estimatedReadyAt` | timestamptz, nullable | Kabulde yazılır |
| `acceptedAt`, `preparingAt`, `readyAt`, `onTheWayAt`, `completedAt`, `closedAt` | timestamptz, nullable | Adım göstergesi bunlardan çizilir; `closedAt` ret/iptal/süre dolmasında |
| `cancelledBy` | enum `customer` \| `cook` \| `system`, nullable | |
| `reason` | `OrderReason`, nullable | |
| `createdAt`, `updatedAt` | | |

**`order_item`**

| Alan | Tip | Not |
|---|---|---|
| `id`, `orderId` | | |
| `productId` | FK product | Ürün soft-delete olduğu için bağ kopmaz |
| `name`, `unitPriceKurus`, `saleType`, `prepMinutes`, `photo` | kopya | Sipariş anındaki değerler; `photo` ilk fotoğrafın dosya kopyası (`file-snapshot`) |
| `quantity` | int 1–20 | |
| `note` | varchar(140), nullable | Ürün notu |

**`payment`**

| Alan | Tip | Not |
|---|---|---|
| `id`, `orderId` (unique) | | |
| `provider` | varchar | `dev` |
| `providerRef` | varchar | |
| `amountKurus` | int | = `totalKurus` |
| `status` | enum `paid` \| `refunded` \| `refund_failed` \| `failed` | |
| `paidAt`, `refundedAt` | timestamptz, nullable | |

**`order_request`** (idempotency) — `key` (unique, `customerId` ile birlikte), `orderId`, `createdAt`. 24 saatten eski satırlar taramayla silinir.

**`kitchen`** — `minOrderKurus` (int, nullable, 0–100000) eklenir; `PATCH /kitchens/me` ve müşteri mutfak detayı bu alanı taşır.

### 2.3 Fiyat ve uygunluk (`order-pricing.ts`, saf fonksiyonlar)

`quoteOrder(kitchen, products, items, fulfillment, address, now, config)` hem teklif hem sipariş oluşturmada kullanılır ve şunu döner:

- `subtotalKurus = Σ unitPrice × quantity` (yalnız sorunsuz kalemler değil, istenen tüm kalemler; sorunlu kalem varsa `canOrder = false`).
- `deliveryFeeKurus`: `pickup` → 0; `delivery` → `deliveryFeeFor(tiers, distanceKm)`, `freeDeliveryMinKurus` doluysa ve `subtotal ≥ eşik` ise 0.
- `serviceFeeKurus = round(subtotal × ORDER_SERVICE_FEE_PERCENT / 100)`.
- `totalKurus = subtotal + delivery + service`.
- `freeDeliveryRemainingKurus` (eşik varsa ve altındaysa), `minOrderRemainingKurus` (minimum varsa ve altındaysa).
- `estimatedMinutes` (§2.1 formülü).
- `issues[]`: `{ productId, kind: 'unavailable' | 'insufficient_portions', available? }` — ürün yok/silinmiş/satışta değil/başka mutfağın → `unavailable`; `daily_portion` ve `portionsAvailable < quantity` → `insufficient_portions` + kalan.
- `blockers[]`: `kitchen_closed` (Faz 2 `openingState` kapalı veya `isPaused`), `fulfillment_unavailable`, `out_of_range` (teslimat yarıçapı dışında), `below_minimum`, `own_kitchen`.
- `canOrder = issues.length === 0 && blockers.length === 0`.

### 2.4 Endpoint'ler

**Müşteri**

| Endpoint | Gövde / sorgu | Yanıt ve hatalar |
|---|---|---|
| `POST /orders/quote` | `kitchenId`, `fulfillment`, `addressId?` (delivery'de zorunlu), `items[{productId, quantity}]` (1–20 kalem) | 200 + §2.3 çıktısı. İş kuralı engelleri 200 içinde. 422 yalnız bozuk gövde; 404 mutfak görünür değil veya `addressId` başkasının. |
| `POST /orders` | quote gövdesi + `note?`, `items[].note?`, `expectedTotalKurus`, `acceptedTerms: true`; başlık `Idempotency-Key` (uuid, zorunlu) | 201 + sipariş detayı. Aynı anahtar → ilk sipariş, 200. `canOrder = false` → 422 (`field`: `items.N.productId`, `kitchenId`, `addressId`, `fulfillment`; `message`: issue/blocker adı). Toplam ≠ `expectedTotalKurus` → **409 `orderTotalChanged`** + `data.quote`. Ödeme başarısız → **402 `paymentFailed`**; sipariş ve porsiyon düşümü geri alınır. |
| `GET /orders?scope=active\|past&page&limit` | | Sayfalı liste: `id`, `code`, `status`, mutfak (ad, kapak), kalem özeti, `totalKurus`, `createdAt`, `estimatedReadyAt`. `active` en yeni üstte. |
| `GET /orders/:id` | | Detay: kalemler, tutarlar, zaman damgaları, `fulfillment`, `deliveryAddress`, `pickupCode`, mutfak kartı (ad, kapak, semt, aşçı adı/fotoğrafı), `kitchenAddress` (yalnız gel-al ve `accepted…ready`: `fullAddress`, `latitude`, `longitude`), `reason`, `cancelledBy`, `payment.status`, `expiresAt`. Başkasının siparişi 404. |
| `POST /orders/:id/cancel` | | Yalnız `pending`; aksi 409 `orderStatusConflict`. |

**Aşçı** (`/kitchens/me/orders`; mutfağı olmayana 404, Faz 2 gibi)

| Endpoint | İş |
|---|---|
| `GET /kitchens/me/orders?tab=new\|preparing\|ready\|done&page&limit` | `new` = pending (en eski üstte); `preparing` = accepted + preparing; `ready` = ready + on_the_way; `done` = İstanbul saatine göre bugün kapananlar (en yeni üstte). |
| `GET /kitchens/me/orders/summary` | `counts { new, preparing, ready }`, `today { orders, revenueKurus }` (bugün `completed` olanlar; ciro = ara toplam), `week { orders, revenueKurus }` (pazartesiden beri), `hasEverCompleted` (yolculuk adımı için). |
| `GET /kitchens/me/orders/:id` | Detay: müşteri adı (ad + soyadın baş harfi), kalemler + notlar, tutarlar, `deliveryAddress`, zaman damgaları, `expiresAt`. `pickupCode` ve telefon dönmez. |
| `POST …/:id/accept` | `pending → accepted`; `estimatedReadyAt` yazılır. |
| `POST …/:id/reject` `{ reason }` | `pending → rejected` + geri alma. |
| `POST …/:id/start` | `accepted → preparing`. |
| `POST …/:id/ready` | `preparing → ready`. |
| `POST …/:id/dispatch` | `ready → on_the_way` (yalnız delivery). |
| `POST …/:id/complete` `{ pickupCode? }` | pickup: `ready → completed`, kod zorunlu, yanlışsa **422 `pickupCode`**; delivery: `on_the_way → completed`. |
| `POST …/:id/cancel` `{ reason }` | `accepted \| preparing → cancelled` + geri alma. |

Geçersiz geçiş her yerde **409 `orderStatusConflict`**.

### 2.5 Zamanlanmış iş ve yan etkiler

- `@nestjs/schedule` eklenir. `OrdersExpiryTask` 30 sn'de bir `status = pending AND expiresAt < now` siparişleri tek tek §2.1 geri alma ile `expired` yapar; ayrıca 24 saatten eski `order_request` satırlarını siler.
- Okuma uçları (`GET /orders*`, `GET /kitchens/me/orders*`) dönmeden önce süresi geçmiş `pending` kayıtları aynı servisle kapatır.
- **Hesap silme:** müşteri veya aşçı olarak aktif siparişi varsa **409 `activeOrdersExist`** (`UsersService.remove` başında kontrol). Kapalı siparişler silinmez; kullanıcı anonimleştirilir (Faz 1), müşterinin siparişlerindeki `deliveryAddress` aynı silme zincirinde (anonimleştirme → **sipariş adresleri** → ürünler → mutfak → adresler → oturumlar) tek UPDATE ile boşaltılır (KVKK, Faz 2 §8 ile aynı gerekçe).
- **Ürün düzenleme/silme** aktif siparişi etkilemez (kalemler kopya).

### 2.6 Yapılandırma

`ORDER_ACCEPT_MINUTES` (3), `ORDER_DELIVERY_BUFFER_MINUTES` (15), `ORDER_SERVICE_FEE_PERCENT` (5), `PAYMENT_PROVIDER` (`dev`), `DEV_PAYMENT_FAIL` (false; production'da yok sayılır). Config modülü Faz 1 desenindeki gibi doğrulanır.

### 2.7 Seed

Yalnız geliştirme: seed mutfaklarından birine `minOrderKurus`, birine `freeDeliveryMinKurus`; ilk seed mutfağına (`dev:+905550000101`) seed müşterisinden her durumdan birer sipariş (`pending` hariç — süresi dolar; ödeme `dev` sağlayıcısıyla `paid`/`refunded`).

## 3. Mobil

### 3.1 Store

- `store/cart` slice (redux-persist): `kitchenId`, `kitchenName`, `items[{ productId, name, unitPriceKurus, photo, saleType, quantity, note }]`, `note`, `fulfillment`, `addressId`. Fiyat/ad yalnız gösterim için; tutarlar teklifle gelir. Çıkışta (logout reset) temizlenir.
- `store/order`: `quoteOrder` (mutation), `createOrder`, `getOrders`, `getOrder`, `cancelOrder`; aşçı: `getCookOrders`, `getCookOrderSummary`, `getCookOrder`, `advanceCookOrder` (accept/start/ready/dispatch/complete), `rejectCookOrder`, `cancelCookOrder`. Mutasyonlar `Order` / `CookOrder` tag'lerini ve porsiyon değiştiği için `MyProducts`, `Discover` tag'lerini invalid eder.
- `Idempotency-Key` sepet ekranı açıldığında üretilir, başarılı siparişte yenilenir; ağ hatasında aynı anahtarla tekrar denenir.

### 3.2 Müşteri ekranları

| Rota | İçerik |
|---|---|
| `/product/[id]` (mevcut) | Altta sabit çubuk: adet seçici (1–20; `daily_portion`'da en fazla kalan porsiyon), "Not ekle" alanı ("Az acılı olsun", 140), "Sepete ekle · ₺180". Mutfak kapalıysa pasif + "Şu an kapalı · 11:00'de açılır". Ekleme: haptic + toast "Sepete eklendi" + "Sepete git" eylemi. Başka mutfağın ürünü sepetteyse "Sepetin temizlensin mi?" onayı. |
| `/kitchen/[id]`, `/product/[id]` | Sepet bu mutfaktansa altta yüzen "Sepet · 2 ürün · ₺360" düğmesi → `/cart`. |
| `/cart` (kök Stack) | Mutfak başlığı; kalemler (adet stepper'ı, sola kaydır sil, not düzenle); Gel-al / Adrese teslim segmenti (mutfakta kapalı olan pasif); teslimatta adres satırı (yerel alt sayfa listesi; Keşfet'teki seçili adres varsayılan); sipariş notu; özet kartı (ara toplam, teslimat — eşik geçildiyse "Ücretsiz", hizmet bedeli, toplam) ve kalan tutar çubuğu ("Ücretsiz teslimata ₺40 kaldı" / "Minimum tutara ₺40 kaldı"); ödeme satırı "Test ödemesi" (bilgi); mesafeli satış sözleşmesi onay kutusu (metin bağlantısı yer tutucu sayfa); altta sabit "Siparişi onayla · ₺X". Sepet/teslim tipi/adres değişince teklif 300 ms debounce ile alınır; `issues` ilgili satırda ("Satıştan kalktı — çıkar" / "Yalnız 2 porsiyon kaldı — 2 yap"), `blockers` düğmenin üstünde. 409 → "Tutar güncellendi" toast + yeni teklif. 402 → hata toast'ı, sepet kalır. Boş sepet: `EmptyState` "Sepetin boş" + "Keşfet'e dön". |
| `/order/[id]` (kök Stack) | Sipariş verilince `replace` ile açılır; ilk açılışta kısa başarı animasyonu (Reanimated, Lottie yok). Kod, adım göstergesi (Gönderildi → Aşçı onayladı → Hazırlanıyor → Hazır → Yolda / Teslim alınabilir → Tamamlandı, zaman damgalarıyla), tahmini saat, mutfak/aşçı kartı (dokununca mutfak detayı). Gel-al ve `accepted…ready`: adres + "Yol tarifi" (Apple/Google Haritalar'ı açar) + büyük 4 haneli teslim kodu. `pending`: geri sayım "Aşçının yanıtı bekleniyor · 2:41" + "Siparişi iptal et" (onay diyaloğu). Kapalı: ret/iptal/süre dolması için net mesaj + sebep + "Ödemen iade edildi" (`refund_failed` ise "İaden işleniyor"). Kalemler ve tutar özeti her durumda. |
| `(app)/orders` (Siparişlerim, mevcut boş sekme) | Aktif / Geçmiş segmenti; kart: mutfak kapağı, ad, durum rozeti, kalem özeti, tutar, tarih; dokununca `/order/[id]`. Geçmiş kartında "Tekrar sipariş ver" (kalemleri sepete koyar — gerekiyorsa temizleme onayı — ve `/cart`'ı açar). Boş: "Henüz siparişin yok". Pull-to-refresh, sonsuz kaydırma. |

**Takip çubuğu:** müşteri sekmelerinde (`(app)/_layout`) aktif sipariş varken tab bar'ın üstünde kalıcı bileşen: tek siparişte "Siparişin hazırlanıyor · ~15 dk" (duruma göre metin) → `/order/[id]`; birden fazlasında "2 aktif sipariş" → Siparişlerim. iOS'ta `NativeTabs`'in alt aksesuar alanı kullanılabiliyorsa o, değilse ekran altına yüzen kart (plan doğrular).

**Sorgulama:** aktif sipariş varken `getOrders({scope:'active'})` 15 sn'de bir; `/order/[id]` açıkken detay 10 sn'de bir; uygulama öne gelince hemen. Aktif sipariş yokken sorgulama yok.

### 3.3 Aşçı ekranları

- **Sekmeler:** `(cook)` NativeTabs → **Siparişler** (`(cook)/orders`, ilk sekme) · Menüm · Mutfağım · Profil. Aşçı moduna geçiş Siparişler'e iner.

| Rota | İçerik |
|---|---|
| `(cook)/orders` | Üstte "bugün" kartı (Menüm'deki `KitchenTodayCard` deseni: açık/kapalı durumu, Duraklat/Devam et, bugünkü sipariş sayısı ve ciro). Segment: Yeni · Hazırlanıyor · Hazır · Tamamlanan (sayı rozetleriyle). **Yeni kartı:** geri sayım ("2:41 içinde yanıtla", süre dolunca kart düşer), müşteri adı, teslim tipi (+ mesafe), kalemler ve notlar, sipariş notu, tutar, büyük "Kabul et" / "Reddet". Reddet → yerel alt sayfada sebep listesi. Diğer sekme kartları: kod, durum, kalem özeti, tahmini saat, tek ilerletme düğmesi. Boş durumlar sekme başına. |
| `/cook-order/[id]` (kök Stack) | Kalemler + notlar, müşteri, teslimat adresi (teslimatta, "Haritada aç"), zaman çizelgesi, tutarlar. Altta tek büyük düğme: "Hazırlamaya başla" → "Hazır" → "Yola çıktım" (teslimat) / "Teslim kodunu gir" (gel-al: sayısal klavyeli 4 haneli alan, yanlışta alan hatası) → "Teslim edildi". `accepted`/`preparing`'de ikincil "Siparişi iptal et" (sebep alt sayfası + onay). |

- **Yeni sipariş uyarısı:** uygulama ön plandayken `getCookOrderSummary` 30 sn'de bir (Siparişler ekranı odaktayken liste 10 sn'de bir); `counts.new` artınca `expo-haptics` bildirimi + toast "Yeni sipariş · Görüntüle" ve Siparişler sekmesinde rozet. Ses ve push Faz 6.
- **Mevcut ekranlara bağlantı:**
  - Profil'deki "Bu hafta" kartı `summary.week`'ten dolar.
  - Yolculukta "İlk siparişini al" adımı `hasEverCompleted` ile `done` olur ("Yakında" kalkar).
  - Mutfağım "Teslimat ve gel-al" bölümüne "Minimum sipariş tutarı" (₺, isteğe bağlı) eklenir.
  - Müşteri mutfak detayında "Min. sipariş ₺150" bilgisi gösterilir.

### 3.4 Ortak

- Tüm yeni metinler `tr` ve `en`'de; durum ve sebep adları i18n anahtarı (`orders.status.preparing`, `orders.reason.too_busy`).
- Para gösterimi `formatKurus`. Geri sayım `expiresAt`'ten, sunucu ile saat farkı yok sayılır (cihaz saati).
- Faz 2'nin kalıpları geçerli: kök Stack'teki formlarda `usePreventRemove`, seçimler yerel alt sayfa (`BottomSheet native`), hatalar Toast.

## 4. Hata yönetimi

- **422:** sipariş engelleri ve ürün sorunları (§2.4); `quantity` 1–20; `note` uzunlukları; `acceptedTerms` true değilse; `pickupCode` 4 rakam değil ya da yanlış; `reason` enum dışı; `minOrderKurus` 0–100000.
- **402** `paymentFailed`. **404** başkasının siparişi, mutfağı olmayana `/kitchens/me/orders*`. **409** `orderStatusConflict`, `orderTotalChanged` (+ yeni teklif), `activeOrdersExist`.
- **Mobil:** 409 `orderStatusConflict` → toast "Sipariş durumu değişti" + detayı yeniden çek; ağ hatasında sipariş düğmesi aynı idempotency anahtarıyla tekrar dener; teklif alınamazsa özet kartında "Tutar hesaplanamadı · Tekrar dene" ve sipariş düğmesi pasif.

## 5. Test ve doğrulama

**Backend birim:** `quoteOrder` (eşik sınırı `≥`, minimum, hizmet bedeli yuvarlama, kademe dışı, kapalı/duraklatılmış mutfak, kendi mutfağı, porsiyon yetersiz, satışta olmayan/başka mutfağın ürünü), durum geçiş tablosu (her durum × her eylem), `estimatedReadyAt`, `code` ve `pickupCode` üretimi, geri alma (porsiyon iadesi, silinmiş ürün, `refund_failed`).

**Backend e2e** (Faz 2 akışına eklenir):

1. Müşteri teklif alır: eşik altı/üstü teslimat ücreti, minimum altı → `below_minimum`, uzak adres → `out_of_range`.
2. `POST /orders` (daily_portion 2 adet) → porsiyon 2 düşer, `payment.paid`; aynı `Idempotency-Key` → aynı sipariş, porsiyon tekrar düşmez.
3. Yanlış `expectedTotalKurus` → 409 + teklif. `DEV_PAYMENT_FAIL` → 402, porsiyon değişmez.
4. Aşçı reddeder → porsiyon geri, `refunded`; müşteri `pending` iptal eder → aynı; `accepted` iken müşteri iptali → 409.
5. Teslimat siparişi: accept → start → ready → dispatch → complete; pickup siparişi: `complete` yanlış kod → 422, doğru kod → completed; `kitchenAddress` yalnız `accepted…ready` arasında dolu.
6. Süre dolması: `expiresAt` geçmiş sipariş okuma anında `expired`, porsiyon geri.
7. Başka müşteri siparişi görmez (404); aşçı başka mutfağın siparişini göremez/ilerletemez (404); aşçı yanıtında `pickupCode` yok.
8. Aktif siparişi olan müşteri/aşçı hesabını silemez (409).
9. `summary`: bugün tamamlanan sipariş sayısı ve ciro.

**Mobil:** `./scripts/check.sh` (tsc + eslint) temiz, React Compiler bailout kontrolü temiz.

## 6. "Bitti" tanımı

Lokal backend'e karşı iki hesapla (aşçı `5550000301`, müşteri `5550000302`), iOS simülatörde:

1. Müşteri ürün detayından not ve adetle sepete ekler; başka mutfaktan eklerken temizleme onayı çıkar.
2. Sepette teslim tipini değiştirir; ücretsiz teslimat ve minimum tutar çubukları doğru; satıştan kalkan ürün uyarısı çıkar.
3. Gel-al siparişi verir → takip ekranı, geri sayım; aşçı tarafında 30 sn içinde haptic + toast + rozet.
4. Aşçı kabul eder → müşteri adresi, yol tarifini ve teslim kodunu görür; aşçı hazırla → hazır → kodu girer → tamamlandı; müşteride Geçmiş'e düşer.
5. Teslimat siparişi aşçı tarafından sebeple reddedilir → müşteri ret mesajını ve iadeyi görür; porsiyon Menüm'de geri gelir.
6. Yanıtlanmayan sipariş 3 dk sonra `expired`.
7. Takip çubuğu aktif siparişte görünür, sipariş kapanınca kaybolur.
8. Profil "Bu hafta" ve yolculuk adımı gerçek veriyle güncellenir.
9. Tüm metinler `tr` ve `en`'de; light/dark temada okunur.

## 7. Kapsam dışı

Gerçek ödeme sağlayıcısı, kayıtlı kartlar, 3D Secure, aşçı hakedişi/komisyon, Kazançlar sekmesi (Faz 5); değerlendirme, yorumlar, favoriler, sorun bildir, mesajlaşma (Faz 4); push, yeni sipariş sesi, canlı (websocket) güncelleme, arka planda uyarı (Faz 6); ileri saatli sipariş; ürün seçenekleri/ekstralar; kupon; çoklu cihaz sepeti; kurye/üçüncü taraf teslimat; fatura/fiş belgesi.
