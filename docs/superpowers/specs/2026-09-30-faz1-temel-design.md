# Faz 1 — Temel (auth, roller, onboarding, adresler)

- **Tarih:** 2026-09-30
- **Kaynak gereksinim:** `Sofram: UI/UX Notları` (README) §2, §3, §4.12 (kısmen), §6
- **Repolar:** `sofram-backend` (NestJS + TypeORM/PostgreSQL), `sofram-mobile` (Expo Router + RTK Query)
- **Bu spec iki repoyu da kapsar;** API sözleşmesinin sahibi backend olduğu için burada durur.

## 0. Faz yol haritası

| Faz | Kapsam |
|---|---|
| **1 — Temel** (bu spec) | API zarfı, telefonla giriş, rol/mod, onboarding, konum izni, adresler, hesap silme |
| 2 — Katalog | Mutfak, ürün, kategori, alerjen; Keşfet/Ara/Harita/Mutfak detay/Ürün detay; aşçı Menüm + Mutfağım; basit mutfak açma |
| 3 — Sipariş | Sepet, ödeme, sipariş durum makinesi, takip çubuğu, aşçı sipariş ekranı, Siparişlerim |
| 4 — Güven | Değerlendirme, yorumlar, favoriler, sorun bildir, mesajlaşma |
| 5 — Aşçı başvurusu & finans | Başvuru sihirbazı (kimlik/belge), admin onayı → "Doğrulanmış" rozeti, kazançlar/hakediş |
| 6 — Bildirim & canlılık | Push, yeni sipariş sesi, canlı durum güncellemesi |

Her faz kendi spec → plan → uygulama döngüsünden geçer ve çalışır halde teslim edilir.

## 1. Alınan kararlar

| Karar | Gerekçe |
|---|---|
| SMS/OTP **Firebase Phone Auth** ile yapılacak; entegrasyonu kullanıcı sonradan ekler. | Kod gönderme/doğrulama istemcide olur; backend yalnızca Firebase `idToken`'ını doğrular. |
| Mobilde `PhoneAuthService`, backend'de `PhoneTokenVerifier` arayüzü; Faz 1'de ikisi de **dev implementasyonu**. | Firebase'e geçiş iki repoda birer sınıf/dosya değişikliği olur, akışın geri kalanı değişmez. |
| Bir kullanıcı **basit mutfak açma** ile aşçı olur (Faz 2); onay Faz 5'te gelir ve "Doğrulanmış" rozetini verir. | Faz 2–3 başvuru sihirbazını beklemeden uçtan uca test edilebilir. Onaysız mutfaklar keşifte görünür, rozetsiz. |
| Aktif mod (müşteri/aşçı) **sunucuda tutulmaz**, mobilde kalıcı `mode` slice'ında. | Mod bir görünüm tercihi; yetki kararı `user.kitchen` varlığına göre sunucuda verilir. |
| Email/şifre girişi yalnızca **admin** için kalır, mobilde görünmez. | Swagger ve ileride admin onayları için. |
| Google ve Apple girişi korunur. | README §3.2. |
| Konum sorguları için PostGIS yok; `latitude`/`longitude` sütunları. | Faz 2'deki mesafe sorgusu ölçekte haversine ile yeterli; ekstra Postgres eklentisi kurulumu gerektirmez. |
| İki ayrı GitHub reposu. | Kullanıcı tercihi. |

## 2. Backend

### 2.1 Yanıt zarfı ve hata formatı

- **`ResponseEnvelopeInterceptor`** (global, `ClassSerializerInterceptor`'dan sonra çalışır — serileştirilmiş gövdeyi sarar):
  ```json
  { "data": <body>, "status": true, "statusCode": 200, "message": "OK" }
  ```
  `204 No Content` dönen endpoint'ler sarılmaz. Mesaj varsayılanı `HttpStatus` adıdır; bir controller `@ResponseMessage('…')` decorator'ı ile override edebilir.
- **`AllExceptionsFilter`** (global):
  ```json
  { "data": null, "status": false, "statusCode": 422, "message": "Doğrulama hatası",
    "errors": [{ "field": "address.district", "message": "..." }] }
  ```
  - Boilerplate'in `UnprocessableEntityException({ errors: { email: 'notFound' } })` şekli ve `ValidationPipe` çıktısı, nokta yollu `{field, message}[]` dizisine tek yerde (`flattenValidationErrors`) çevrilir.
  - 5xx: loglanır, istemciye genel mesaj döner; stack trace asla sızmaz.
- Swagger şemaları zarfı gösterir (`ApiEnvelopeResponse(Type)` yardımcı decorator'ı).
- `infinityPagination` yanıtları `data: { data: T[], hasNextPage }` olarak sarılır — mevcut yapı korunur.

### 2.2 Kimlik doğrulama

| Endpoint | Gövde | Yanıt `data` |
|---|---|---|
| `POST /api/v1/auth/phone` | `{ idToken }` | `{ isNewUser, token, refreshToken, tokenExpires, user }` |
| `POST /api/v1/auth/social` | `{ provider: 'google'\|'apple', idToken, firstName?, lastName? }` | aynı |
| `POST /api/v1/auth/refresh` | (Bearer refreshToken) | `{ token, refreshToken, tokenExpires }` |
| `POST /api/v1/auth/logout` | — | 204 |
| `POST /api/v1/auth/email/login` | `{ email, password }` | yalnızca admin rolü; diğerlerine 403 |

- `PhoneTokenVerifier` arayüzü: `verify(idToken): Promise<{ phoneNumber: string /* E.164 */ }>`.
  - `DevPhoneTokenVerifier`: `dev:+905551112233` formatını kabul eder. Yalnızca `AUTH_PHONE_DEV_VERIFIER=true` açıkça verildiğinde provider'a bağlanır (NODE_ENV'e bakılarak açılmaz; production'da bayrak açık olsa da bağlanmaz). Bayrak yoksa ve gerçek (Firebase) verifier da yoksa uygulama açılışta hata verir — fail-closed.
  - `FirebasePhoneTokenVerifier`: kullanıcı ekler (`firebase-admin` → `verifyIdToken` → `phone_number`).
- Numara ilk kez görülürse `provider = 'phone'`, isimsiz bir kullanıcı oluşturulur ve `isNewUser: true` döner.
- Mevcut session/refresh mekanizması (boilerplate `SessionService`) aynen kullanılır.
- `AuthProvidersEnum`'a `phone` eklenir; `facebook` kaldırılır.

### 2.3 Kullanıcı

Hygen generator ile eklenecek alanlar:

| Alan | Tip | Not |
|---|---|---|
| `phoneNumber` | string, unique, nullable | E.164 |
| `profileCompleted` | boolean, default false | ad + KVKK tamamlanınca true |
| `kvkkAcceptedAt` | Date, nullable | |
| `marketingConsent` | boolean, default false | |
| `allergenPreferences` | string[] (simple-array) | Faz 2'de kullanılır, Faz 1'de yalnızca saklanır |

| Endpoint | Not |
|---|---|
| `GET /api/v1/me` | kullanıcı + `hasKitchen` (Faz 1'de her zaman false) |
| `PATCH /api/v1/me` | `firstName`, `lastName`, `kvkkAccepted`, `marketingConsent`, `allergenPreferences`, `photo`. `firstName` + `lastName` + KVKK dolunca `profileCompleted = true` |
| `DELETE /api/v1/me` | soft delete, `phoneNumber`/`email` anonimleştirilir (`deleted:<id>`), tüm session'lar silinir. 204 |

Mobil `User` tipi (API'nin döndürdüğü): `{ id, firstName, lastName, phoneNumber, email, photo, profileCompleted, marketingConsent, allergenPreferences, hasKitchen, role, createdAt }`.

### 2.4 Adresler

Entity `Address` (hygen generator), `user` → `manyToOne`:

`title` (string, "Ev"/"İş"/serbest), `fullAddress`, `district`, `neighborhood`, `buildingNo?`, `floor?`, `apartmentNo?`, `directions?`, `latitude` (numeric), `longitude` (numeric), `isDefault` (boolean).

| Endpoint | Not |
|---|---|
| `GET /api/v1/me/addresses` | varsayılan önce, sonra `createdAt` desc |
| `POST /api/v1/me/addresses` | kullanıcının ilk adresi otomatik `isDefault` |
| `PATCH /api/v1/me/addresses/:id` | `isDefault: true` → diğerleri aynı transaction'da false |
| `DELETE /api/v1/me/addresses/:id` | varsayılan silinirse en yeni adres varsayılan olur |

Sahiplik: servis katmanında tek yardımcı (`findOwnedOrFail(userId, id)`) — başkasının kaydı için **404** (varlığı sızdırmamak için 403 değil). Faz 2+ entity'leri de aynı yardımcıyı kullanır.

### 2.5 Temizlik

- Kullanılmayan boilerplate parçaları dokunulmadan kalır (email onay/şifre sıfırlama admin için zararsız). Faz 1 kapsamı dışında silme yapılmaz.

## 3. Mobil

### 3.1 Giriş yönlendirmesi

`resolveEntryRoute(state)` (`src/utils/entryRoute.ts`) — tek karar noktası; `app/index.tsx` ve grup layout guard'ları bunu kullanır:

1. `!onboardingSeen` → `Routes.WELCOME`
2. `!accessToken` → `Routes.LOGIN_PHONE`
3. `!isProfileComplete(user)` → `Routes.LOGIN_PROFILE`
4. `!intentChosen` → `Routes.LOGIN_ROLE`
5. `!locationResolved` (izin verildi **veya** en az bir adres var) → `Routes.LOCATION`
6. aksi halde → `Routes.EXPLORE`

`onboardingSeen`, `intentChosen`, `locationResolved` kalıcı bir `app` slice'ında durur (throttled persist, sıcak değil).

### 3.2 Ekranlar

| Rota | Bileşen | Davranış |
|---|---|---|
| `(onboarding)/welcome` | `onboarding/Welcome` | 3 kaydırmalı sayfa (`react-native-pager-view`), nokta göstergesi, "Atla" ve son sayfada "Başla". `onboardingSeen = true`. |
| `(onboarding)/cook` | `onboarding/CookIntro` | Mevcut; RoleStep'te aşçı seçilince bilgi sayfası olarak kalır. |
| `(onboarding)/login` | `auth/Login/partials/PhoneStep` | Mevcut `PhoneLogin` buraya taşınır; `PhoneAuthService.sendCode` → VerifyStep. Google/Apple butonları kalır. |
| `(onboarding)/login/verify` | `auth/Login/partials/VerifyStep` | `OtpCodeInput` (6 kutu, `textContentType="oneTimeCode"`), 60 sn geri sayım + "Tekrar gönder", yanlış kodda sallama + hata. Onay → `idToken` → `POST auth/phone`. |
| `(onboarding)/login/profile` | `auth/Login/partials/ProfileStep` | Ad, soyad (`InputController`), KVKK zorunlu + pazarlama izni opsiyonel `Checkbox`; metinler `BottomSheet` içinde. `PATCH /me`. |
| `(onboarding)/login/role` | `auth/Login/partials/RoleStep` | İki büyük kart. Müşteri → devam; Aşçı → `CookIntro`'ya bir kez gösterilir, sonra devam (mutfak açma Faz 2). `intentChosen = true`. |
| `(onboarding)/location` | `location/LocationPermission` | Önce açıklama, sonra sistem izni. İzin → `expo-location` ile konum + ters geocoding → adres formu önceden dolu açılır. Red → boş adres formu. |
| `(app)/profile/addresses` | `address/AddressList` | Liste, varsayılan rozeti, sola kaydırıp sil, boş durum. |
| `(app)/profile/addresses/edit` | `address/AddressForm` | Parametre `id?`. Üstte harita + sürüklenebilir iğne, altta form. Oluştur/güncelle aynı bileşen. |

`Routes`/`RouteParams` her yeni rota için güncellenir (kural: `screens.md`).

### 3.3 Sekmeler ve modlar

- `(app)` müşteri sekmeleri: **Keşfet · Ara · Siparişlerim · Favoriler · Profil**.
  - Keşfet = mevcut `home/Home`, `explore/Explore` olarak taşınır; rota `(app)/explore`, `Routes.EXPLORE`. Üstteki adres seçici varsayılan adrese bağlanır, dokununca adres seçim sheet'i açılır.
  - Ara, Siparişlerim, Favoriler → Faz 1'de `EmptyState`.
  - Mevcut `discover/Discover` (harita) Faz 2'de Keşfet'in liste/harita geçişine taşınır; o zamana kadar kod yerinde kalır, `(app)/discover` ve `(app)/home` rotaları kaldırılır.
- `(cook)` grubu iskeleti: Siparişler · Menüm · Mutfağım · Kazançlar · Profil — Faz 1'de hepsi `EmptyState`, farklı renkte üst bar. Profil'deki mod anahtarı yalnızca `user.hasKitchen` iken görünür (Faz 1'de görünmez).
- `mode` slice (`customer`|`cook`, kalıcı). Geçiş `navigation.replace` ile ilgili grubun köküne gider.

### 3.4 Profil (Faz 1 kısmı)

Mevcut `profile/Profile` genişletilir: kişisel bilgiler (düzenle → `PATCH /me`), Adreslerim, dil, tema, sözleşmeler (sheet), çıkış, **Hesabı sil** (Alert onayı → `DELETE /me` → oturum temizliği → Welcome). "Mutfağını aç" banner'ı (`CookCta`) kalır; Faz 1'de `CookIntro`'ya gider.

### 3.5 Yeni / değişen ortak parçalar

- `ui/EmptyState` (ikon, başlık, açıklama, opsiyonel aksiyon butonu)
- `ui/Skeleton` (shimmer kutu; listeler kendi skeleton satırlarını bundan kurar)
- `ui/Checkbox` (`ControllableProps` uyumlu; `InputController` ile bağlanabilir)
- `ui/NetworkBanner` + `@react-native-community/netinfo` — kök layout'ta bir kez.
- `services/phoneAuth/` — `PhoneAuthService` arayüzü + `devPhoneAuth.ts` (`sendCode` gecikmeli başarı; `confirm('123456')` → `dev:<E.164>`). Firebase'e geçiş: `firebasePhoneAuth.ts` + tek satır export değişikliği.

### 3.6 Store

- `auth.api`: `authPhone`, `socialAuth`, `refresh`, `logout`, `getMe`, `updateMe`, `deleteMe`. Kullanılmayan `login`/`forgotPassword`/`resetPassword`/`requestOtp`/`verifyOtp` kaldırılır.
- `auth.slice`: `accessToken` + `refreshToken` + `tokenExpires` + `user`.
- `baseApi`: `baseQueryWithReauth` — 401'de tek seferlik refresh (eşzamanlı istekler tek refresh'i bekler, mutex), başarısızsa `logout` + `Routes.LOGIN_PHONE`.
- `address/address.api.ts` + `address.types.ts`, tag `Address`.
- `auth.types` `User` tipinden agrigo kalıntıları (`tenant`, `userType`, `isTenantOwner`, `isApprovedByTenant`, `fullName`) temizlenir; `constants/accountType.ts` kullanılmıyorsa silinir.
- `.env.example` `EXPO_PUBLIC_API_URL=http://localhost:3001/api/v1/` olarak güncellenir.

## 4. Hata yönetimi

| Durum | Backend | Mobil |
|---|---|---|
| Alan doğrulama | 422 + `errors[]` | `setFormErrors` → input altında; RHF dışı alanlarda `getApiFieldError` |
| Oturum süresi doldu | 401 | refresh → tekrar dene; olmazsa çıkış + giriş ekranı |
| Başkasının kaydı | 404 | genel "bulunamadı" |
| Ağ yok | — | `NetworkBanner`; mutasyonlar hata toast'ı |
| OTP yanlış / çok deneme | (istemci tarafı) | kutular sallanır + satır altı hata |
| Konum izni reddi | — | manuel adres formu; Profil'den "Ayarlar'da izin ver" bağlantısı |
| 5xx | log + genel mesaj | `Alert` (genel) |

## 5. Test ve doğrulama

**Backend (Jest):**
- Unit: `ResponseEnvelopeInterceptor`, `AllExceptionsFilter` + `flattenValidationErrors`, `AuthService.phoneLogin` (yeni / mevcut / silinmiş kullanıcı), `DevPhoneTokenVerifier`, `AddressesService` (ilk adres varsayılan, varsayılan değişimi, varsayılan silinince devir, sahiplik 404).
- E2E (`test/`, lokal Postgres): `auth/phone` → `GET /me` → `PATCH /me` → adres CRUD → `DELETE /me` → aynı token ile 401.
- `npm run lint` ve `npm run build` temiz.

**Mobil:**
- `scripts/check.sh` (`tsc --noEmit` + `eslint`) temiz.
- React Compiler bailout denetimi: sayı artmaz.
- iOS simülatöründe elle uçtan uca akış (§6).

## 6. "Bitti" tanımı

Temiz kurulumda, lokal backend'e karşı:

1. Onboarding → telefon → `123456` → ad + KVKK → rol → konum izni **veya** manuel adres → Keşfet.
2. Her adımda uygulama öldürülüp açılınca aynı adımdan devam eder.
3. Profil: bilgileri düzenle, adres ekle/düzenle/varsayılan yap/sil, dil ve tema değiştir, çıkış yap, hesabı sil.
4. Token süresi dolunca kullanıcı fark etmeden yenilenir.
5. Tüm kullanıcıya görünen metinler `tr` ve `en` kataloglarında.

## 7. Kapsam dışı

Gerçek Firebase bağlantısı (kullanıcı ekler), push bildirim (Faz 6), mutfak açma ve aşçı ekranlarının içeriği (Faz 2), davet et/kazan, alerjen tercih ekranı (Faz 2 — alan Faz 1'de saklanır).

## 8. Uygulama notları (plan yazılırken yapılan düzeltmeler — yukarıdaki bölümleri geçersiz kılar)

Kod incelendiğinde boilerplate'te hazır olan endpoint'leri yeniden yazmak yerine genişletmek daha az kod ve daha az tekrar demek; bu yüzden:

| Spec'teki | Uygulanan | Neden |
|---|---|---|
| `POST auth/phone` | `POST /api/v1/auth/phone/login` | Mevcut `auth/google/login`, `auth/apple/login` ile aynı şekil |
| `POST auth/social` | Mevcut `auth/google/login` ve `auth/apple/login` aynen kalır | Zaten var; mobil `provider`'a göre URL seçer |
| `GET/PATCH/DELETE /me` | Mevcut `GET/PATCH/DELETE /api/v1/auth/me` genişletilir | Zaten var |
| `/me/addresses` | `/api/v1/addresses` — her rota yalnızca giriş yapmış kullanıcının adreslerine erişir | Generator'ın ürettiği yol; kapsam JWT'den gelir |
| Email login yalnızca admin (diğerlerine 403) | Email endpoint'leri olduğu gibi kalır, mobilde görünmez | 403 kuralı mevcut e2e paketini yeniden yazdırır, güvenlik kazancı yok (email hesabı da sıradan kullanıcıdır) |
| `@ResponseMessage` decorator'ı, `ApiEnvelopeResponse` Swagger yardımcısı | Yok; Swagger açıklamasında zarf tek cümleyle anlatılır | Faz 1'de kullanan yer yok (YAGNI) |
| `profileCompleted` sütunu | Sütun yok; mapper'da `firstName && lastName && kvkkAcceptedAt`'ten türetilir | Saklanan türev alan kayar |
| `allergenPreferences`, `hasKitchen` | Faz 2'ye taşındı | Faz 1'de okuyan/yazan yok |
| Dev doğrulayıcı `NODE_ENV !== 'production'` ile bağlanır | NODE_ENV guard → açık `AUTH_PHONE_DEV_VERIFIER` opt-in, fail-closed (bayrak yoksa açılışta hata; production'da bayrak açıksa da hata) | `app.nodeEnv` varsayılanı `development`; NODE_ENV'i unutulmuş/staging bir kurulumda `dev:+90…` herkes adına giriş yaptırıyordu |
