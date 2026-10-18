# Faz 4 — Güven (değerlendirme, yorumlar, favoriler, sorun bildir, mesajlaşma)

- **Tarih:** 2026-10-19
- **Kaynak gereksinim:** `Sofram: UI/UX Notları` (README) §1 (güven hissi), §4.1 (puan, favori kalbi), §4.4 (puan, Yorumlar sekmesi), §4.9 ("Değerlendir", "Sorun bildir"), §4.10, §4.11, §5.6, §6 (mesajlaşma)
- **Önceki fazlar:** Faz 1, Faz 2, [Faz 3](2026-10-18-faz3-siparis-design.md) — §8 düzeltmeleri dahil, bu spec onları değiştirmez.
- **Repolar:** `sofram-backend`, `sofram-mobile`. API sözleşmesinin sahibi backend.
- **Not:** Bu spec kullanıcı uyurken, kendi verdiğim ürün kararlarıyla yazıldı; her kararın gerekçesi §1'de. Sabah gözden geçirilecek — değişen karar, uygulanmış kodu da değiştirir.

## 1. Alınan kararlar

| Karar | Gerekçe |
|---|---|
| **Değerlendirme yalnız `completed` siparişe**, sipariş başına **bir kez**, tamamlanmadan sonraki **7 gün** içinde. Düzenlenemez; yazan silebilir. | Puanı yalnız gerçekten yemiş olan verir. Düzenleme, aşçı yanıtından sonra yorumun değişmesine yol açar. |
| Genel puan **1–5 yıldız zorunlu**; alt kriterler (lezzet, porsiyon, paketleme, zamanlama) **isteğe bağlı** 1–5; hızlı etiketler sabit listeden (0–3); yorum ≤ 500; fotoğraf 0–3. | README §4.10. Alt kriterleri zorunlu yapmak tamamlama oranını düşürür; özette yalnız genel puan kullanılır. |
| Mutfak puanı **`kitchen.ratingAvg` + `ratingCount`** olarak saklanır, değerlendirme yazılınca/silinince/gizlenince aynı transaction'da yeniden hesaplanır. | Keşif kartları her istekte AVG sorgusu yapmaz. |
| Puan kartta/detayda `ratingCount ≥ 1` olunca görünür ("4,8 (12)"); 0 ise "Yeni". | Boş puan "0" gibi görünmesin. |
| **Aşçı yanıtı:** değerlendirme başına bir yanıt (≤ 300), düzenlenebilir/silinebilir. **Aşçı bildirimi:** değerlendirmeyi sebeple bildirir (`offensive`, `false_claim`, `not_my_order`, `other`); değerlendirme görünür kalır, admin Swagger'dan gizleyebilir. Gizli değerlendirme puana katılmaz. | README §5.6. Aşçının kötü yorumu kendi başına kaldırması güveni zedeler. |
| **Favoriler yalnız mutfak** (ürün değil). | Ev mutfağında menü günden güne değişir; müşteri aşçıyı takip eder. README'de kalp mutfak kartında. |
| **Sorun bildir:** `completed`, `cancelled` (aşçı iptali) veya `on_the_way`'de takılı kalan sipariş için, kapanıştan sonraki **48 saat** içinde, sipariş başına bir açık kayıt. Kategoriler `missing_item`, `wrong_item`, `quality_hygiene`, `late`, `health_issue`, `other`; açıklama zorunlu (10–1000); fotoğraf 0–3; istenen çözüm `refund_full`, `refund_partial`, `none`. | README §4.11. Gecikme şikâyeti teslim edilmemiş siparişte de olabilir. |
| Sorunları **admin Swagger'dan** çözer (`resolved` + isteğe bağlı iade tutarı, ya da `rejected`) ve not yazar. İade `PaymentsService` üzerinden (dev sağlayıcı), **kısmi iade** destekli. Yeni sorun `SUPPORT_EMAIL`'e mail atar. | Admin paneli kapsam dışı (Faz 2 kararı); mail destek ekibine hemen ulaşır. |
| `health_issue` seçilince istemci "Acil bir durumdaysan 112'yi ara" uyarısı gösterir. | Sağlık riski uygulama içi süreci beklememeli. |
| **Mesajlaşma sipariş bazlı**: müşteri ↔ aşçı, siparişin oluşmasından **kapanıştan 24 saat sonrasına** kadar yazılabilir, sonra salt okunur. Metin ≤ 500, fotoğraf yok. Hazır cevaplar istemcide sabit liste. Telefon numarası hiçbir tarafa dönmez. | README §6. Sipariş dışı sohbet taciz/pazarlık kanalına dönüşür. |
| Mesajlar **sorgulamayla** gelir (sohbet açıkken 5 sn; siparişin okunmamış sayısı sipariş listesi/özetiyle). Push ve websocket Faz 6. | Faz 3 kararıyla aynı. |
| Okunmamış sayısı `order.customerLastReadAt` / `cookLastReadAt` ile hesaplanır. | Mesaj başına okundu bilgisi gerekmez. |
| **Değerlendirme hatırlatması:** push yok (Faz 6). Siparişlerim'de ve takip ekranında "Değerlendir" kartı; tamamlanmış, değerlendirilmemiş ve 7 günü dolmamış en yeni sipariş için uygulama açılışında **bir kez** alt sayfa (istemci hangi siparişi sorduğunu hatırlar). | README §4.10'un push'suz hali. |
| Keşif sıralamasına puan **girmez**; filtre/sıralama Faz 2'deki gibi kalır. | Az yorumlu yeni mutfakları cezalandırmamak; sıralama ayrı bir ürün kararı. |
| **Hesap silme:** kullanıcının değerlendirmeleri soft-delete edilir ve mutfak puanları yeniden hesaplanır; favorileri ve yazdığı mesajlar hard-delete; açtığı sorun kayıtları kalır (anlaşmazlık kaydı), fotoğrafları ve açıklaması korunur, kullanıcı zaten anonim. Aşçının hesabı silinince mutfağın değerlendirmeleri ve yanıtları soft-delete. | KVKK: yorum metni ve mesaj kişisel veri; sorun kaydı yasal süreç için gerekebilir. |

## 2. Backend

Tüm yeni entity'ler `generate` skill'iyle üretilir; sahiplik `orNotFound(...)`; yanıtlar Faz 1 zarfıyla; tüm uçlar JWT. Fotoğraflar Faz 2'deki gibi `FileSnapshot` jsonb dizisi (`file-snapshot.ts`), var olan dosya olmalı.

### 2.1 Veri modeli

**`review`**

| Alan | Tip | Not |
|---|---|---|
| `id` | uuid | |
| `orderId` | FK order, unique | Sipariş başına bir |
| `kitchenId` | FK kitchen | index (`kitchenId`, `createdAt`) |
| `authorId` | FK user | |
| `rating` | smallint 1–5 | |
| `taste`, `portion`, `packaging`, `timing` | smallint 1–5, nullable | |
| `tags` | simple-array (`ReviewTag`) | `homemade`, `generous_portion`, `arrived_hot`, `well_packaged`, `on_time`, `friendly_cook` |
| `comment` | varchar(500), nullable | |
| `photos` | jsonb `FileSnapshot[]` | 0–3 |
| `reply` | varchar(300), nullable | Aşçı yanıtı |
| `repliedAt` | timestamptz, nullable | |
| `isHidden` | boolean, default false | Admin |
| `createdAt`, `updatedAt`, `deletedAt` | | soft delete |

**`review_report`** — `id`, `reviewId`, `reporterId` (aşçı), `reason` (`ReviewReportReason`), `note` varchar(300) nullable, `createdAt`; (`reviewId`, `reporterId`) unique.

**`favorite`** — `id`, `userId`, `kitchenId`, `createdAt`; (`userId`, `kitchenId`) unique.

**`order_issue`**

| Alan | Tip | Not |
|---|---|---|
| `id`, `orderId` | | Sipariş başına bir **açık** kayıt (kısmi unique index `status = 'open'`) |
| `reporterId` | FK user | |
| `category` | `IssueCategory` | |
| `description` | varchar(1000) | 10–1000 |
| `photos` | jsonb `FileSnapshot[]` | 0–3 |
| `requestedResolution` | `refund_full` \| `refund_partial` \| `none` | |
| `status` | `open` \| `resolved` \| `rejected` | |
| `refundKurus` | int, nullable | Çözümde uygulanan iade |
| `adminNote` | varchar(500), nullable | Müşteriye ve aşçıya görünür |
| `resolvedAt` | timestamptz, nullable | |
| `createdAt`, `updatedAt` | | |

**`order_message`** — `id`, `orderId` (index `orderId, createdAt`), `senderId`, `senderRole` (`customer` \| `cook`), `body` varchar(500), `createdAt`.

**`order`** — `customerLastReadAt`, `cookLastReadAt` (timestamptz, nullable) eklenir.

**`kitchen`** — `ratingAvg` (numeric(2,1) yerine `double precision`, nullable), `ratingCount` (int, default 0) eklenir; mutfak kartı, özet ve detay yanıtlarına girer.

**`payment`** — `refundedKurus` (int, default 0) eklenir; tam iade `amountKurus`'a eşitler. Kısmi iade sonrası durum `paid` kalır, `refundedKurus` artar; toplam iade `amountKurus`'u geçemez.

### 2.2 Kurallar (saf, birim testli)

- `canReview(order, now)`: `status = completed`, `completedAt + 7 gün > now`, değerlendirme yok.
- `canReportIssue(order, now)`: `completed` veya aşçı tarafından `cancelled` ise `(completedAt ?? closedAt) + 48 saat > now`; `on_the_way` ise `onTheWayAt + 2 saat < now` (takıldı); açık kayıt yok.
- `canMessage(order, now)`: aktif ya da `closedAt/completedAt + 24 saat > now`.
- `ratingSummary(reviews)`: gizli ve silinmiş hariç ortalama, tek ondalığa yuvarlanmış (`Math.round(avg × 10) / 10`).

### 2.3 Endpoint'ler

**Müşteri**

| Endpoint | İş |
|---|---|
| `POST /orders/:id/review` | Gövde: `rating`, `taste?`, `portion?`, `packaging?`, `timing?`, `tags?`, `comment?`, `photos?` (dosya id'leri). `canReview` değilse **409 `reviewNotAllowed`**; ikinci kez **409 `reviewExists`**. 201 + değerlendirme. |
| `DELETE /reviews/:id` | Yalnız yazan; 204; puan yeniden hesaplanır. |
| `GET /discover/kitchens/:id/reviews?page&limit` | Mutfağın görünür değerlendirmeleri, en yeni üstte; yazar "Ad S." + fotoğrafı; yanıt. Yanıt `{ data, hasNextPage, summary: { ratingAvg, ratingCount, distribution: {1..5}, topTags[] } }`. |
| `POST /kitchens/:id/favorite`, `DELETE /kitchens/:id/favorite` | İdempotent (204). Görünür olmayan mutfak 404. |
| `GET /favorites?lat&lng&page&limit` | Favori mutfaklar, Faz 2 `KitchenCard` şeklinde (açık/kapalı, mesafe, puan), favoriye eklenme sırasıyla en yeni üstte; artık görünür olmayan mutfak listede "erişilemiyor" olarak değil, hiç dönmez. |
| `POST /orders/:id/issues` | Gövde: `category`, `description`, `photos?`, `requestedResolution`. `canReportIssue` değilse **409 `issueNotAllowed`**. 201. Destek mailı (`SUPPORT_EMAIL`). |
| `GET /orders/:id` (Faz 3) | Ek alanlar: `review` (varsa özet), `canReview`, `issue` (son kayıt: kategori, durum, `refundKurus`, `adminNote`), `canReportIssue`, `unreadMessages`, `canMessage`. |
| `GET /orders` (Faz 3) | Kartlara `unreadMessages`, `canReview` eklenir. |

**Aşçı**

| Endpoint | İş |
|---|---|
| `GET /kitchens/me/reviews?page&limit&filter=all\|unreplied` | Kendi mutfağının değerlendirmeleri (gizliler "Gizlendi" etiketiyle dahil). |
| `PUT /kitchens/me/reviews/:id/reply` `{ reply }`, `DELETE …/reply` | Yanıt yaz/düzenle/sil. |
| `POST /kitchens/me/reviews/:id/report` `{ reason, note? }` | Bildir; ikinci kez **409 `reviewAlreadyReported`**. |
| `GET /kitchens/me/orders/:id` (Faz 3) | Ek: `review`, `issue` (salt okunur), `unreadMessages`, `canMessage`. |
| `GET /kitchens/me/orders/summary` (Faz 3) | Ek: `rating { avg, count }`, `unrepliedReviews`, `unreadMessages`. |

**Mesajlaşma (iki taraf; sipariş tarafı yetkiyi belirler)**

| Endpoint | İş |
|---|---|
| `GET /orders/:id/messages?after` | Müşteri; `after` (ISO zaman) verilirse yalnız yeniler; en eski üstte, en çok 100. Okuma `customerLastReadAt = now` yazar. |
| `POST /orders/:id/messages` `{ body }` | Müşteri; `canMessage` değilse **409 `messagingClosed`**. |
| `GET /kitchens/me/orders/:id/messages?after`, `POST …/messages` | Aşçı karşılıkları (`cookLastReadAt`). |

**Admin** (Swagger, `RoleEnum.admin`)

| Endpoint | İş |
|---|---|
| `GET /admin/issues?status` | Liste. |
| `PATCH /admin/issues/:id` `{ status: resolved\|rejected, refundKurus?, adminNote? }` | `resolved` + `refundKurus` → `PaymentsService.refundPartial(orderId, kurus)`; toplam iade ödenen tutarı aşarsa **422 `refundKurus`**. |
| `GET /admin/review-reports`, `PATCH /admin/reviews/:id` `{ isHidden }` | Bildirilen değerlendirmeler; gizle/göster (puan yeniden hesaplanır). |

### 2.4 Yapılandırma

`SUPPORT_EMAIL` (geliştirmede maildev'e gider), `REVIEW_WINDOW_DAYS` (7), `ISSUE_WINDOW_HOURS` (48), `MESSAGING_WINDOW_HOURS` (24).

### 2.5 Seed

Yalnız geliştirme: Faz 3 seed'inin tamamlanmış siparişlerine değerlendirmeler (biri yanıtlı, biri fotoğraflı), seed müşterisine iki favori, bir siparişe 4 mesajlık sohbet, bir açık sorun kaydı. Mutfak puanları seed sonunda yeniden hesaplanır.

## 3. Mobil

### 3.1 Müşteri

| Yer | İçerik |
|---|---|
| `KitchenCard`, mutfak detayı | Puan ("★ 4,8 (12)" / "Yeni"); kalp (iyimser güncelleme + haptic + küçük ölçek animasyonu, hata olursa geri alınır, toast). |
| Mutfak detayı | Menü altında "Yorumlar" bölümü: özet (ortalama, dağılım çubukları, sık etiketler) + son 3 değerlendirme + "Tüm yorumlar" → `/kitchen/[id]/reviews` (kök Stack, sonsuz liste). Değerlendirme satırı: yazar, yıldız, tarih, etiketler, yorum, fotoğraf küçükleri (dokununca tam ekran), aşçı yanıtı girintili. |
| `(app)/favorites` (mevcut boş sekme) | Favori mutfaklar listesi (KitchenCard), pull-to-refresh; boş: "Beğendiğin mutfakları kalbe dokunarak buraya ekle". Keşfet'teki seçili adres mesafe için kullanılır. |
| `/order/[id]` (Faz 3) | Tamamlanmışsa "Değerlendir" kartı (ya da verilen puanın özeti); "Sorun bildir" satırı (izinliyse) ve açık/çözülmüş kayıt durumu kartı (admin notu, iade tutarı); "Mesajlar" düğmesi (okunmamış rozetli). |
| `/order/[id]/review` (kök Stack, form) | Büyük yıldız seçici (zorunlu), alt kriterler için küçük yıldız satırları (isteğe bağlı), etiket çipleri (en çok 3), yorum alanı, fotoğraf ekleme (0–3, Faz 2 `PhotoField` deseni), altta sabit "Gönder". `usePreventRemove` ile kaydedilmemiş değişiklik uyarısı. |
| `/order/[id]/issue` (kök Stack, form) | Kategori (yerel liste alt sayfası), `health_issue` seçilince 112 uyarı kartı, açıklama (10–1000, sayaç), fotoğraf 0–3, istenen çözüm segmenti, "Gönder". Başarıda toast "Talebini aldık" + geri. |
| `/order/[id]/chat` (kök Stack) | Sohbet: balonlar (benim/karşı taraf), tarih ayraçları, altta klavyeye yapışan giriş (`KeyboardStickyView`), hazır cevap çipleri ("Geliyorum", "Kapıdayım", "Teşekkürler"), gönderimde iyimser balon (hata: "Gönderilemedi · Tekrar dene"). 5 sn'de bir `after` ile sorgu. Pencere kapalıysa giriş yerine "Bu sohbet kapandı" notu. |
| Siparişlerim | Kartta okunmamış mesaj rozeti ve "Değerlendir" düğmesi. |
| Değerlendirme hatırlatması | (app) layout açılışında: tamamlanmış, değerlendirilmemiş, penceresi açık en yeni sipariş için bir kez alt sayfa ("Ayşe'nin Mutfağı'ndan siparişin nasıldı?" + yıldızlar → forma geçer). Sorulan sipariş id'leri `app` slice'ında kalıcı. |

### 3.2 Aşçı

| Yer | İçerik |
|---|---|
| Profil (`CookProfile`) | "Puan" ve "Yorum" istatistikleri `summary.rating`'den gerçek; yeni "Yorumlar" satırı (yanıtlanmamış sayısı rozetli) → `/cook-reviews`. |
| `/cook-reviews` (kök Stack) | Tümü / Yanıtlanmamış segmenti; değerlendirme kartı + "Yanıtla" (alt sayfada metin alanı; düzenle/sil) + "Bildir" (sebep listesi + not). Gizlenmiş değerlendirmede "Gizlendi" etiketi. |
| `/cook-order/[id]` (Faz 3) | "Mesajlar" düğmesi (rozetli) → `/cook-order/[id]/chat`; değerlendirme ve sorun kaydı varsa salt okunur kartlar. |
| `/cook-order/[id]/chat` | Müşteri sohbetiyle aynı bileşen; hazır cevaplar "Yoldayım", "Kapıdayım", "Siparişin hazır". |
| Siparişler sekmesi | Kartlarda okunmamış mesaj rozeti; özet sorgusu (Faz 3, 30 sn) `unreadMessages` artınca haptic + toast "Yeni mesaj". |

### 3.3 Ortak

- Sohbet ekranı tek bileşen (`OrderChat`), taraf (`customer` | `cook`) prop ile; uç adresleri taraftan seçilir.
- Yıldız seçici (`StarRating`, salt okunur ve seçilebilir), puan rozeti (`RatingBadge`), değerlendirme satırı (`ReviewItem`) ortak bileşenler.
- Tüm yeni metinler `tr` ve `en`'de; etiket, kategori, sebep adları i18n anahtarı.
- Faz 2/3 kalıpları: kök Stack formları, `usePreventRemove`, yerel alt sayfalar, Toast, `formatKurus`.

## 4. Hata yönetimi

- **422:** puan aralıkları, etiket listede değil / 3'ten fazla, yorum/yanıt/not uzunlukları, fotoğraf 0–3 ve var olan dosya, açıklama 10–1000, kategori/çözüm/sebep enum dışı, `refundKurus` ≤ 0 veya iade toplamını aşıyor, mesaj boş ya da > 500.
- **404:** başkasının siparişi/değerlendirmesi, görünür olmayan mutfak (favori, yorum listesi).
- **409:** `reviewNotAllowed`, `reviewExists`, `reviewAlreadyReported`, `issueNotAllowed`, `messagingClosed`.
- **Mobil:** 409'larda ekranı yeniden çek + açıklayıcı toast; favori hatasında kalbi geri al.

## 5. Test ve doğrulama

**Backend birim:** `canReview` (7 gün sınırı, durumlar), `canReportIssue` (48 saat, aşçı iptali, takılı teslimat), `canMessage` (24 saat), `ratingSummary` (gizli/silinmiş hariç, yuvarlama), kısmi iade toplam sınırı, okunmamış sayısı hesabı.

**Backend e2e:**
1. Tamamlanmış siparişe değerlendirme → mutfak puanı ve sayısı güncellenir; ikinci değerlendirme 409; tamamlanmamış siparişe 409.
2. Aşçı yanıt yazar/düzenler/siler; bildirir (ikinci kez 409); admin gizler → puandan düşer, müşteri listesinde yok.
3. Favori ekle/çıkar idempotent; `GET /favorites` kart şeklinde; mutfak duraklatılınca listede kalır, silinince düşer.
4. Sorun bildir: pencere içinde 201 + mail (maildev); ikinci açık kayıt 409; admin kısmi iade → `payment.refundedKurus`; fazla iade 422.
5. Mesaj: iki taraf yazar/okur, `after` yalnız yenileri döner, okunmamış sayısı okuyunca sıfırlanır; pencere kapanınca 409; üçüncü kişi 404.
6. Hesap silme: değerlendirmeler düşer, puan yeniden hesaplanır; mesajlar ve favoriler silinir; sorun kaydı kalır.

**Mobil:** `./scripts/check.sh` temiz, React Compiler bailout kontrolü temiz.

## 6. "Bitti" tanımı

Lokal backend'e karşı iki hesapla iOS simülatörde:

1. Müşteri tamamlanmış siparişi değerlendirir (yıldız + etiket + yorum + fotoğraf); mutfak kartında ve detayında puan görünür.
2. Aşçı Profil > Yorumlar'dan yanıt yazar; müşteri yorum listesinde yanıtı görür.
3. Müşteri mutfağı favoriler, Favoriler sekmesinde görür, kaldırır.
4. Aktif siparişte iki taraf mesajlaşır; okunmamış rozetleri görünür ve okununca kaybolur; hazır cevaplar çalışır.
5. Müşteri sorun bildirir; admin Swagger'dan kısmi iadeyle çözer; müşteri sipariş detayında çözümü görür.
6. Uygulama açılışında değerlendirme hatırlatması bir kez çıkar.
7. Tüm metinler `tr` ve `en`'de; light/dark temada okunur.

## 7. Kapsam dışı

Push ve canlı mesaj (Faz 6); mesajda fotoğraf/konum; ürün favorisi; puana göre sıralama/filtre; yorum beğenme; aşçının müşteriyi değerlendirmesi; otomatik içerik denetimi (küfür/telefon filtresi); admin paneli (Swagger yeterli); "davet et / kazan"; aşçı doğrulama rozeti (Faz 5).
