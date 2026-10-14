# Faz 2 — Katalog (mutfak, ürün, kategori, alerjen, keşif)

- **Tarih:** 2026-10-15
- **Kaynak gereksinim:** `Sofram: UI/UX Notları` belgesi bulunamadı; gereksinimler kullanıcıyla soru-cevapla çıkarıldı (§1).
- **Önceki faz:** [`2026-09-30-faz1-temel-design.md`](2026-09-30-faz1-temel-design.md) — §8'deki düzeltmeler dahil.
- **Repolar:** `sofram-backend` (NestJS + TypeORM/PostgreSQL), `sofram-mobile` (Expo Router + RTK Query). Spec iki repoyu kapsar; uygulama iki ayrı planla yapılır (önce backend, sonra mobil).

## 1. Alınan kararlar

| Karar | Gerekçe |
|---|---|
| Ürün başına **satış tipi**: `on_demand` (sipariş üzerine, hazırlanma süresi) veya `daily_portion` (bugün N porsiyon). | Ev aşçısı ikisini de yapar. Faz 2 yalnızca alanları tutar/gösterir; porsiyonu siparişle düşürmek Faz 3. |
| Mutfak **gel-al ve/veya teslimat** açar; en az biri zorunlu. | İki model de yaygın. |
| Teslimat ücreti **mesafe kademeleri** (`upToKm` → `feeKurus`) + isteğe bağlı **ücretsiz teslimat eşiği**; ikisini de aşçı girer. Son kademenin `upToKm`'i teslimat yarıçapıdır. | Mesafeye göre ücret, müşteriye öngörülebilir tutar. Eşik Faz 3'te sepetle devreye girer. |
| Gel-al görünürlüğü platform sabiti: `DISCOVERY_PICKUP_RADIUS_KM` (varsayılan 5). | Aşçıya ek ayar yükü yok. |
| **Kategoriler platformun sabit listesi**, admin yönetir, seed ile gelir. | Keşfet/Ara'da tutarlı filtre. Aşçıya özel menü bölümleri kapsam dışı. |
| **14 alerjen** (Türk Gıda Kodeksi / AB) ve diyet etiketleri (`vegetarian`, `vegan`) koddaki sabit listeler. | Değişmeyen, düzenlemeyle tanımlı küme; tablo gereksiz. |
| Kullanıcının alerjen tercihi varsa **"Alerjenlerime uygun" filtresi açık başlar**, kapatılabilir; kapalıyken çakışan ürünler uyarıyla görünür. Ürün detayında "Alerjen bilgisi aşçının beyanıdır" notu. | Kazara maruziyeti azaltır, seçenekten koparmaz. |
| Mutfak açık/kapalı = **haftalık çalışma saatleri** + **elle duraklatma**. Saat dilimi sabit `Europe/Istanbul`. | Yalnız saatler esnek değil, yalnız toggle unutulur. |
| Kapalı mutfaklar Keşfet'te **listenin sonunda** "Şu an kapalı · HH:mm'de açılır" etiketiyle görünür; sipariş (Faz 3) verilemez. | Menüye göz atılabilir. |
| Mutfak konumu dışarıya **yaklaşık** verilir: koordinat `DISCOVERY_COORD_PRECISION` (varsayılan 3 ondalık ≈ 110 m) hanesine yuvarlanır; detayda semt + mesafe. Tam adres Faz 3'te onaylı gel-al siparişinde açılır. | Aşçının ev adresi herkese açık olmaz. Mesafe sunucuda tam koordinatla hesaplanır. |
| Mutfak adresi, aşçının adres defterinden seçilen adresin **kopyasıdır**. | Müşteri tarafı adres düzenlemesi mutfağı bozmaz. |
| Bir kullanıcının **en fazla bir** mutfağı olur. | Basit sahiplik; `ownerId` unique. |
| Ürün başına **1–5 fotoğraf**. | Detayda galeri, kartta ilk fotoğraf. |
| Keşfet **bölümlü**: üstte "Yakınındaki mutfaklar" yatay şeridi, altta yemek akışı; liste/harita geçişi. Ara aynı filtreleri kullanır, sonuçlar "Mutfaklar" / "Yemekler". | Hem "ne yesem" hem "kimden alsam" aramasını karşılar; mevcut mock yapıya yakın. |
| Keşif/arama **düz PostgreSQL**: bounding-box ön filtresi + haversine; arama, uygulamada Türkçe-katlanmış `searchText` sütununda `LIKE`. Eklenti yok. | Faz 1'deki "PostGIS yok" kararıyla uyumlu; Postgres `lower()`'ın İ/ı sorunu uygulamada çözülür. `pg_trgm`'e geçiş sonradan tek migration. |
| Aşçı müşteri modundayken **kendi mutfağını Keşfet'te görür**. | Ayrı kural yok; menüsünün müşteriye nasıl göründüğünü görür. |

## 2. Backend

Tüm yeni entity'ler `generate` skill'iyle (hygen) üretilir; sahiplik `orNotFound(...)`, yanıtlar Faz 1 zarfıyla. Tüm endpoint'ler JWT ister.

### 2.1 Veri modeli

**`category`**

| Alan | Tip | Not |
|---|---|---|
| `slug` | string, unique | `main-dish`, `soup`… |
| `nameTr`, `nameEn` | string | API `Accept-Language`'e göre tek `name` döner (`nestjs-i18n` `HeaderResolver`) |
| `icon` | string, nullable | mobil ikon anahtarı |
| `sortOrder` | int | |
| `isActive` | boolean, default true | silme yok; pasifleştirme |

**`kitchen`**

| Alan | Tip | Not |
|---|---|---|
| `owner` | → user, unique | |
| `name` | string | 2–60 karakter |
| `description` | string, nullable | ≤ 500 |
| `coverPhoto` | → file, nullable | |
| `fullAddress`, `district`, `neighborhood` | string | adres defterinden kopya |
| `latitude`, `longitude` | double | tam değer; dışarıya yuvarlanır. `(latitude, longitude)` index |
| `pickupEnabled`, `deliveryEnabled` | boolean | en az biri true |
| `freeDeliveryMinKurus` | int, nullable | Faz 3'te kullanılır |
| `isPaused` | boolean, default false | |
| `isVerified` | boolean, default false | Faz 5 |
| `searchText` | string | `name` + `description` + `district` + `neighborhood`, Türkçe katlanmış |
| `deletedAt` | soft delete | |

**`kitchen_delivery_tier`** — `kitchen`, `upToKm` (decimal, kesin artan, ≤ 20), `feeKurus` (int ≥ 0). Mutfak başına 1–5 kademe; teslimat kapalıysa 0.

**`kitchen_hours`** — `kitchen`, `dayOfWeek` (1 = Pazartesi … 7 = Pazar), `opensAt`, `closesAt` (`"HH:mm"`, `opensAt < closesAt`). Gün başına birden çok, çakışmayan aralık. Gece yarısını aşan aralık yok.

**`product`**

| Alan | Tip | Not |
|---|---|---|
| `kitchen` | → kitchen | |
| `category` | → category | aktif olmalı |
| `name` | string | 2–80 |
| `description` | string, nullable | ≤ 1000 |
| `priceKurus` | int | 1 – 10 000 000 |
| `saleType` | enum `on_demand` \| `daily_portion` | |
| `prepMinutes` | int, nullable | `on_demand` ise zorunlu (1–600), değilse null |
| `portionsAvailable` | int, nullable | `daily_portion` ise zorunlu (0–999), değilse null |
| `allergens` | simple-array, `Allergen` enum | |
| `dietTags` | simple-array, `DietTag` enum | |
| `isActive` | boolean, default true | "satışta" |
| `searchText` | string | `name` + `description` |
| `deletedAt` | soft delete | Faz 3 siparişleri ürüne bağlanacak |

**`product_photo`** — `product`, `file`, `sortOrder`. Ürün başına 1–5.

**`user`** — `allergenPreferences` (simple-array, `Allergen` enum, default boş) eklenir (Faz 1 §8'de buraya taşınmıştı). `hasKitchen` saklanmaz; `UserMapper.toDomain`'de türetilir.

**Sabitler** (`src/catalog/` altında, tek dosya):
- `Allergen`: `gluten`, `crustaceans`, `eggs`, `fish`, `peanuts`, `soy`, `milk`, `tree_nuts`, `celery`, `mustard`, `sesame`, `sulphites`, `lupin`, `molluscs`.
- `DietTag`: `vegetarian`, `vegan`.

**Konfigürasyon** (`.env`, `env-example-relational`): `DISCOVERY_PICKUP_RADIUS_KM=5`, `DISCOVERY_COORD_PRECISION=3`.

### 2.2 Ortak yardımcılar (saf fonksiyonlar, birim testli)

- `foldTurkish(text)`: `İ→i`, `I→ı→i`, `ş→s`, `ğ→g`, `ü→u`, `ö→o`, `ç→c`, küçük harf, boşluk sadeleştirme. `searchText` yazarken ve `q` sorgusunda aynı fonksiyon.
- `deliveryFeeFor(tiers, distanceKm)`: `distanceKm ≤ upToKm` olan ilk kademenin ücreti; yoksa `null` (teslimat yok).
- `openingState(hours, isPaused, now)`: `{ isOpenNow, opensAt: Date | null }`; `Europe/Istanbul`'a göre, 7 gün ileri bakar.
- `roundCoord(value, precision)`.
- `haversineKm(a, b)` (SQL ifadesiyle aynı formül; birim testte karşılaştırılır).

### 2.3 Endpoint'ler (`/api/v1`)

**Kategoriler**
- `GET /categories` — aktifler, `sortOrder` sırasıyla.
- `POST /categories`, `PATCH /categories/:id` — yalnızca admin (`RolesGuard`).

**Aşçı — kendi mutfağı** (kapsam JWT'den; başkasınınki 404)
- `POST /kitchens/me` — gövde: `{ name, description?, coverPhotoId?, addressId, pickupEnabled, deliveryEnabled, deliveryTiers: [{ upToKm, feeKurus }], freeDeliveryMinKurus?, hours: [{ dayOfWeek, opensAt, closesAt }] }`. `addressId` kullanıcının olmalı (değilse 404). Mutfak varsa 409.
- `GET /kitchens/me` — tam adres ve tam koordinat dahil (sahibine).
- `PATCH /kitchens/me` — kısmi; `hours` veya `deliveryTiers` gelirse liste bütünüyle değişir; `addressId` gelirse adres yeniden kopyalanır; `isPaused` buradan.
- `GET /kitchens/me/products`, `POST /kitchens/me/products`, `PATCH /kitchens/me/products/:id`, `DELETE /kitchens/me/products/:id` (soft, 204). Ürün gövdesinde `photoIds: string[]` (sıra = `sortOrder`).
- Mutfağı olmayan kullanıcıya `/kitchens/me*` → 404.

**Müşteri — keşif.** Ortak sorgu parametreleri: `lat`, `lng` (zorunlu), `categoryId?`, `diet?` (`vegetarian` | `vegan`), `allergenSafe?` (boolean, default false — mobil tercih varsa true gönderir), `q?` (≥ 2 karakter).
- `GET /discover/kitchens` — şerit, harita ve Ara'nın "Mutfaklar" bölümü. Sayfalı (`page`, `limit` ≤ 50).
- `GET /discover/products` — yemek akışı ve Ara'nın "Yemekler" bölümü. `infinityPagination`.
- `GET /kitchens/:id?lat&lng` — mutfak detayı + aktif ürünleri kategoriye göre gruplu.
- `GET /products/:id?lat&lng` — ürün detayı + mutfak özeti.

**Yanıt şekilleri (özet)**
- Mutfak kartı: `id, name, coverPhoto, district, neighborhood, latitude, longitude` (yuvarlanmış), `distanceKm, isOpenNow, opensAt, isPaused, pickupAvailable, deliveryAvailable, deliveryFeeKurus` (bu konuma; teslimat yoksa null), `freeDeliveryMinKurus, isVerified`.
- Ürün kartı: `id, name, photo` (ilk), `priceKurus, saleType, prepMinutes, portionsAvailable, allergens, dietTags, allergenWarnings` (kullanıcı tercihleriyle kesişim), `category: { id, name }`, `kitchen:` mutfak kartı alt kümesi (`id, name, distanceKm, isOpenNow`).
- Detaylar kartın tamamı + `description`, `photos[]`, mutfakta `hours[]`, `deliveryTiers[]`.

**Kullanıcı**
- `PATCH /auth/me` — `allergenPreferences` kabul eder.
- `GET /auth/me` — `hasKitchen`, `allergenPreferences` döner.
- Hesap silme: `UsersService.remove` tek yolu mutfağı ve ürünlerini de soft-delete eder (aynı transaction).

### 2.4 Görünürlük kuralları (tek yer: `DiscoveryQueryBuilder`)

1. **Mutfak görünür:** silinmemiş **ve** ( `deliveryEnabled` ∧ mesafe ≤ son kademe `upToKm` ) ∨ ( `pickupEnabled` ∧ mesafe ≤ `DISCOVERY_PICKUP_RADIUS_KM` ).
2. **Ürün görünür:** silinmemiş ∧ `isActive` ∧ kategorisi aktif ∧ mutfağı görünür ∧ ( `saleType = on_demand` ∨ `portionsAvailable > 0` ).
3. **Duraklatılmış veya saat dışı mutfak** görünür ama `isOpenNow = false`.
4. **Sıralama:** `isOpenNow` desc, sonra mesafe asc, sonra `id`.
5. **`allergenSafe = true`:** kullanıcının `allergenPreferences` kümesiyle kesişen ürünler elenir; mutfaklar etkilenmez.
6. **`q`:** `foldTurkish(q)` → ürün `searchText LIKE %q%`; mutfak için `kitchen.searchText LIKE %q%` **veya** görünür bir ürününün eşleşmesi.
7. **SQL:** önce `latitude/longitude BETWEEN` kutusu (en geniş yarıçap: max(20 km, pickup)) index'ten, sonra haversine ifadesi `distanceKm` olarak seçilir ve filtrelenir. Sıralamadaki `isOpenNow` SQL'de hesaplanır: `NOT isPaused AND EXISTS (kitchen_hours` satırı, `Europe/Istanbul`'daki şu anki gün ve saati kapsıyor`)`; şu anki gün/saat uygulamada hesaplanıp parametre olarak geçilir (DB saat dilimine bağımlılık yok). `opensAt` yalnızca dönen sayfadaki mutfaklar için uygulamada `openingState` ile hesaplanır.
8. **Detay istisnası:** `GET /kitchens/:id` ve `GET /products/:id` sahibine mesafeden bağımsız açılır; diğerlerine kural 1–2 sağlanmazsa 404.

### 2.5 Seed

- Kategoriler: Ana yemek, Çorba, Hamur işi, Zeytinyağlı, Tatlı, Kahvaltılık, Salata, İçecek (her ortamda).
- Yalnız geliştirme (`NODE_ENV !== 'production'` ve seed komutu): Kadıköy civarında 3 mutfak, 12 ürün (iki satış tipi, çeşitli alerjenler), mevcut seed kullanıcılarına bağlı.

## 3. Mobil

### 3.1 Mod ve gezinme

- `mode` slice (`customer` | `cook`), redux-persist ile kalıcı. Faz 1'den ertelenen.
- `(cook)` route grubu, kendi `NativeTabs`'i: **Menüm**, **Mutfağım**, **Profil** (Siparişler Faz 3).
- Profil: `hasKitchen` ise "Aşçı moduna geç", değilse "Mutfak aç". Aşçı modundaki Profil'de "Müşteri moduna geç".
- Onboarding'de "Aşçı" seçen kullanıcı `CookIntro` sonrası onboarding bitince mutfak açma sihirbazına gider.
- `mode = cook` iken `hasKitchen = false` olursa (ör. başka cihazda hesap/mutfak durumu) müşteri moduna düşülür.

### 3.2 Aşçı ekranları

| Rota | İçerik |
|---|---|
| `(cook)/kitchen/new` | 4 adımlı sihirbaz: (1) ad, açıklama, kapak fotoğrafı; (2) adres — defterden seç veya yeni ekle (Faz 1 adres formu); (3) gel-al/teslimat toggle'ları, teslimat kademeleri, ücretsiz teslimat eşiği; (4) haftalık çalışma saatleri. Son adım `POST /kitchens/me` → aşçı moduna geçiş. Adımlar arası form durumu tek `react-hook-form` örneğinde. |
| `(cook)/kitchen` (Mutfağım) | Üstte büyük "Sipariş al / Duraklat" toggle'ı + açık/kapalı durumu; altında sihirbazdaki alanların düzenleme bölümleri (her biri kendi kaydet'i ile `PATCH /kitchens/me`). |
| `(cook)/menu` (Menüm) | Ürün listesi: fotoğraf, ad, fiyat, satış tipi; satırda "satışta" toggle'ı; `daily_portion` ürünlerde porsiyon stepper'ı. Boşken "İlk ürününü ekle". |
| `(cook)/menu/edit` | Ekle/düzenle formu: fotoğraflar (1–5, `ImagePicker` → `POST /files/upload`, sıralanabilir), ad, açıklama, kategori (`Select`), fiyat (₺, kuruşa çevrilir), satış tipi segmenti → `prepMinutes` veya `portionsAvailable`, alerjen ve diyet etiketleri (çoklu seçim). Düzenlemede "Ürünü sil" (onaylı). |

### 3.3 Müşteri ekranları

| Rota | İçerik |
|---|---|
| `(app)/explore` (Keşfet) | Adres seçici (seçili adresin koordinatı) · kategori çipleri (`GET /categories`, başta "Tümü") · "Alerjenlerime uygun" toggle'ı (tercih varsa açık başlar; tercih yoksa gizli) · "Yakınındaki mutfaklar" yatay şeridi · yemek akışı (LegendList, sonsuz kaydırma) · sağ üstte liste/harita geçişi. Harita: mevcut `DiscoverMap`, mutfaklar yuvarlanmış koordinatta yarı saydam daire + isim etiketiyle; dokununca alt kartta mutfak özeti. |
| `(app)/search` (Ara) | 300 ms debounce'lu arama kutusu, aynı çipler/toggle; sonuçlar "Mutfaklar" ve "Yemekler" bölümleri. `q` < 2 karakterken son aramalar yok, boş durum metni. |
| `(app)/kitchen/[id]` | Kapak, ad, semt, mesafe, açık/kapalı (+ "HH:mm'de açılır"), çalışma saatleri (açılır liste), gel-al/teslimat bilgisi ve bu adrese teslimat ücreti, ürünler kategori başlıklarıyla gruplu. |
| `(app)/product/[id]` | Fotoğraf galerisi, ad, fiyat, `on_demand` → "~45 dk'da hazır" / `daily_portion` → "Bugün N porsiyon kaldı", açıklama, alerjenler (tercihle çakışanlar vurgulu) + "Alerjen bilgisi aşçının beyanıdır", diyet etiketleri, mutfak kartı (dokununca mutfak detayı). Sepete ekle Faz 3. |
| `(app)/profile/allergens` | 14 alerjen için checkbox listesi → `PATCH /auth/me`. Profil menüsüne "Alerjen tercihlerim" satırı. |

### 3.4 Ortak parçalar ve store

- `components/dish/DishCard` gerçek ürün kartı tipine uyarlanır; `allergenWarnings` varsa kartta uyarı rozeti.
- Yeni `KitchenCard` (şerit ve Ara), `AllergenChips`, `OpeningBadge` ("Açık" / "Şu an kapalı · 11:00'de açılır").
- Para gösterimi tek yardımcı: `formatKurus(12500) → "125 ₺"` (`Intl.NumberFormat('tr-TR')`).
- Store: `store/category` (`getCategories`), `store/discover` (`getDiscoverKitchens`, `getDiscoverProducts`, `getKitchen`, `getProduct`), `store/kitchen` (aşçı: `getMyKitchen`, `createMyKitchen`, `updateMyKitchen`, ürün CRUD). Ürün/mutfak mutasyonları ilgili tag'leri invalid eder.
- `store/dish/dish.mock.ts` ve `dish.utils.ts`'teki mock'a bağlı kod silinir; `dish.types.ts` API tipleriyle değiştirilir.
- Tüm yeni metinler `tr` ve `en` kataloglarında; alerjen/diyet adları i18n anahtarı (`allergens.milk`).

## 4. Hata yönetimi

- **422** (Faz 1 formatı, nokta yollu `field`):
  - Mutfak: gel-al ve teslimattan en az biri; teslimat açıksa 1–5 kademe, `upToKm` kesin artan ve ≤ 20; `feeKurus ≥ 0`; saatlerde `opensAt < closesAt`, aynı günde çakışma yok.
  - Ürün: `saleType`'a göre `prepMinutes` / `portionsAvailable` zorunlu, diğeri null; 1–5 fotoğraf ve hepsi var olan dosya; kategori aktif; alerjen/diyet değerleri listede; fiyat aralığı.
  - Keşif: `lat` ∈ [-90, 90], `lng` ∈ [-180, 180]; `q` 2–50 karakter.
- **404:** mutfağı olmayana `/kitchens/me*`; başkasının veya silinmiş ürünü; görünür olmayan mutfak/ürün detayı (sahibi hariç); başkasının `addressId`'si.
- **409:** mutfak zaten var.
- **Mobil:** RTK Query hataları mevcut Toast'a; Keşfet/Ara boş sonuçta `EmptyState`, alerjen filtresi açıkken boşsa "Filtreyi kapat" eylemi; kayıtlı adres yoksa Keşfet adres seçmeye yönlendiren boş durum; `/kitchens/me` 404 → "Mutfak aç".

## 5. Test ve doğrulama

**Backend birim:** `foldTurkish` (İ/ı, ş, ğ… "İçli Köfte" → "icli kofte"), `deliveryFeeFor` (sınırlar, kademe dışı), `openingState` (sabit saat; gün sınırı, duraklatma, çoklu aralık, bir sonraki açılış 7 gün içinde, İstanbul saat dilimi), `roundCoord`, `haversineKm`, DTO doğrulamaları (kademe sırası, saat çakışması, satış tipi koşulları).

**Backend e2e** (Faz 1 e2e akışına eklenir):
1. Telefonla giriş (aşçı) → adres ekle → `POST /kitchens/me` → ürün ekle (iki satış tipi, alerjenli/alerjensiz).
2. İkinci kullanıcı yakın konumdan `GET /discover/products` → ürünleri görür; 30 km uzaktan görmez; gel-al-only mutfak 5 km dışında görünmez.
3. Aşçı `isPaused = true` → mutfak hâlâ listede, `isOpenNow = false`, sıralamada sonda.
4. `daily_portion` ürün `portionsAvailable = 0` → akışta yok.
5. `q=manti` "Mantı"yı bulur; `q=KÖFTE` "köfte"yi bulur.
6. Müşteri `allergenPreferences=['milk']` → `allergenSafe=true` sütlü ürünü eler; `false` iken `allergenWarnings: ['milk']`.
7. Müşteri, aşçının ürününe `PATCH /kitchens/me/products/:id` → 404 (kendi mutfağı yok); başka aşçı → 404.
8. Aşçı hesabını siler → ürünleri ve mutfağı keşiften kalkar.

**Mobil:** `npm run check` (lint + tsc) temiz.

## 6. "Bitti" tanımı

Lokal backend'e karşı, temiz kurulumda simülatörde:

1. Yeni kullanıcı onboarding'de "Aşçı" seçer → sihirbazla mutfak açar → aşçı moduna geçer.
2. Menüm'den iki ürün ekler (fotoğraflı, iki satış tipi); birini satıştan kaldırır, porsiyonunu değiştirir; Mutfağım'dan duraklatır/açar, saat ve kademe düzenler.
3. Müşteri moduna geçer (veya ikinci hesap): Keşfet'te şerit + akış, kategori çipleri, alerjen toggle'ı, harita görünümü çalışır; ürün → ürün detayı → mutfak detayı gezilir.
4. Ara'da Türkçe karakterli ve karaktersiz aramalar aynı sonucu verir.
5. Profil > Alerjen tercihlerim kaydedilir ve Keşfet'i etkiler.
6. Tüm kullanıcıya görünen metinler `tr` ve `en`'de; light/dark temada okunur.

## 7. Kapsam dışı

Sepet, sipariş, porsiyon düşme, ücretsiz teslimat eşiğinin uygulanması (Faz 3); değerlendirme/puan, favoriler (Faz 4); aşçı doğrulama ve "Doğrulanmış" rozetinin verilmesi (Faz 5); aşçıya özel menü bölümleri; gece yarısını aşan çalışma saatleri; yazım hatası toleranslı arama (`pg_trgm`); mutfak kapatma/silme (hesap silme dışında); admin panel (kategoriler Swagger'dan).

## 8. Uygulama notları (plan yazılırken yapılan düzeltmeler — yukarıdaki bölümleri geçersiz kılar)

| Spec'teki | Uygulanan | Neden |
|---|---|---|
| `kitchen_delivery_tier`, `kitchen_hours` tabloları | `kitchen.deliveryTiers` ve `kitchen.hours` **jsonb** sütunları + türetilmiş `kitchen.deliveryRadiusKm` (son kademenin `upToKm`'i; teslimat kapalıysa null) | Her zaman mutfakla birlikte okunup bütünüyle değiştirilen küçük listeler; iki entity/modül ve join gereksiz. Keşif SQL'i yarıçapı sütundan, açık/kapalıyı `jsonb_array_elements` ile okur. API aynı. |
| `product_photo` tablosu, `kitchen.coverPhoto → file` | `product.photos` ve `kitchen.coverPhoto` **jsonb dosya anlık görüntüsü** (`{ id, path }`); okurken `FileType` örneğine çevrilir | Sıra korunur, listelemede join yok; dosya yolları değişmez. |
| Kategori `name`'i `Accept-Language`'e göre | API `nameTr` ve `nameEn` döner, mobil dile göre seçer | Backend'in dil başlığı `x-custom-lang`, mobil sabit `Accept-Language: tr_TR` gönderiyor; iki alanı dönmek dil çözümlemesini tek yere (mobil) koyar. |
| `GET /kitchens/:id`, `GET /products/:id` | `GET /discover/kitchens/:id`, `GET /discover/products/:id` | `/kitchens/me` ile `/kitchens/:id` aynı segment sayısında; ayrı controller'larda kayıt sırasına bağımlı çakışma yerine keşif uçları tek önekte. |
| `saleType`'a ait olmayan alan null olmalı (aksi 422) | Sunucu o alanı null'a çeker; yalnızca ait olan alan zorunlu | Satış tipi değiştirirken istemci eski alanı temizlemek zorunda kalmaz. |
| Teslimat kapalıysa 0 kademe | Kademeler saklanır, teslimat kapalıyken keşifte yok sayılır | Aşçı teslimatı kapatıp açınca kademeleri yeniden girmez. |
| `diet=vegetarian` | Vegan ürünler de eşleşir | Vegan ⊂ vejetaryen. |
| Hesap silmede mutfak + ürünler "aynı transaction" | `UsersService.remove` içinde sırayla (ürünler → mutfak), mevcut adres/oturum adımları gibi | Silme yolunun geri kalanı da transaction'sız; kayıt soft-delete, tekrar çalıştırılabilir. |
| Seed mutfakları mevcut seed kullanıcılarına bağlı | 3 ayrı dev kullanıcısı (`+90555000010{1..3}`), ürünler fotoğrafsız | Kullanıcı başına bir mutfak; repoda görsel yok. Mobil fotoğrafsız ürünü placeholder ile gösterir. |
| `hasKitchen` yalnız `GET /auth/me` | `GET/PATCH /auth/me` ve tüm login yanıtlarındaki `user` | Geri dönen aşçı girişte aşçı moduna yönlendirilebilir. |
| — | Keşif okuma tarafı (`DiscoveryRepository`) port'suz, doğrudan TypeORM sorgu sınıfı | Salt-okuma SQL'i; davranışı e2e ile test edilir, saf kısımlar (görünürlük, kartlar) birim testli. |
