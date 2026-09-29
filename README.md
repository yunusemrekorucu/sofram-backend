# Sofram Backend 🍽️

Sofram'ın REST API'si: mahalledeki ev aşçılarıyla ev yemeği arayan komşuları
buluşturan pazar yeri. Mobil istemci `../sofram-mobile`.

[brocoders/nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate)
üzerine kuruldu (`npm run app:config` ile: yalnızca PostgreSQL/TypeORM; Google
ve Apple girişi açık, Facebook kaldırıldı). Boilerplate'in kendi dokümanı
`docs/` altında duruyor — mimari, auth, dosya yükleme ve üreteçler için oraya bak.

## Yığın

- NestJS 11 · TypeORM · PostgreSQL 16
- JWT (access + refresh), e-posta/şifre, Google ve Apple girişi
- Swagger: <http://localhost:3001/docs>
- Kod üreteçleri (hygen): `generate:resource:relational`, `add:property:to-relational`

## Yerel geliştirme (Docker'sız)

Gereken: Node 24 (`.nvmrc`), Homebrew `postgresql@16`.

```bash
# 1. Veritabanı (bir kez)
psql -d postgres -c "CREATE ROLE sofram LOGIN PASSWORD '<şifre>';"
psql -d postgres -c "CREATE DATABASE sofram OWNER sofram;"

# 2. Ortam (bir kez) — DATABASE_* ve AUTH_*_SECRET değerlerini doldur
cp env-example-relational .env
#   DATABASE_HOST=localhost, DATABASE_USERNAME/NAME=sofram, MAIL_HOST=localhost

# 3. Kurulum ve şema
npm install
npm run migration:run
npm run seed:run:relational   # admin@example.com / secret, john.doe@example.com / secret

# 4. Çalıştır
npx maildev -s 1025 -w 1080   # ayrı terminalde — gelen mailler: http://localhost:1080
npm run start:dev             # http://localhost:3001
```

Docker tercih edilirse `docker compose up -d postgres adminer maildev`
(`docs/installing-and-running.md`); o durumda yerel Postgres ile 5432 portu çakışır.

## Yeni entity ve alan eklemek

Entity dosyalarını elle yazma — üreteçler DTO, modül, repository ve domain
katmanını birlikte oluşturur:

```bash
npm run generate:resource:relational -- --name Dish
npm run add:property:to-relational -- --name Dish --property title --kind primitive --type string --isAddToDto true --isOptional false
npm run migration:generate -- src/database/migrations/AddDish
npm run migration:run
```

Ayrıntılar: `.claude/skills/generate/SKILL.md`, `docs/cli.md`, `docs/database.md`.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run start:dev` | İzlemeli geliştirme sunucusu |
| `npm run build` | `dist/` üretir |
| `npm run lint` | ESLint |
| `npm run test:e2e` | E2E testleri (çalışan API'ye istek atar; veritabanına kayıt yazar) |
| `npm run migration:generate -- src/database/migrations/<Ad>` | Entity farkından migration üretir |
| `npm run migration:run` / `migration:revert` | Migration uygula / geri al |
