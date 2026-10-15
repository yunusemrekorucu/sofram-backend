# Project instructions

Sofram'ın API'si — brocoders/nestjs-boilerplate üzerine kurulu, yalnızca
relational (TypeORM/PostgreSQL) katmanıyla (`app:config` ile MongoDB ve
Facebook auth kaldırıldı). Mobil istemci: `../sofram-mobile`.

## When adding entities, schemas, or properties

Use the `generate` skill (auto-loaded from [.claude/skills/generate/SKILL.md](.claude/skills/generate/SKILL.md)). It documents the project's CLI generators (`npm run generate:resource:relational`, `npm run add:property:to-relational`) which keep DTOs, modules, and migrations in sync. Do not hand-write entity files.

## Local environment

- PostgreSQL 16 from Homebrew on `localhost:5432`, database and role `sofram` (credentials in `.env`, never committed). No Docker.
- Mail goes to maildev: `npx -y maildev@2.2.1 -s 1025 -w 1080`, inbox at <http://localhost:1080>. Pinned because maildev 3 moved its API to `/api/email`; the e2e suite reads `/email`.
- API on `http://localhost:3001`, prefix `/api/v1`, Swagger at `/docs`.
- `npm run build` deletes `dist/` and stops a running `npm run start:dev`; use `npx tsc --noEmit -p tsconfig.json` for a type check while the dev API runs.
- Seeded users: `admin@example.com` / `secret` (Admin), `john.doe@example.com` / `secret` (User).

## API conventions

- Every response is wrapped by `utils/http/ResponseEnvelopeInterceptor` as `{ data, status, statusCode, message }`; errors go through `utils/http/AllExceptionsFilter` as `{ data: null, status: false, statusCode, message, errors?: { field, message }[] }` (dot paths for nested DTOs). 204 is not wrapped. Keep throwing the boilerplate shape (`new UnprocessableEntityException({ status, errors: { field: 'key' } })`) — the filter flattens it.
- Records that belong to a user are looked up scoped to that user and wrapped in `orNotFound(...)` (`utils/or-not-found.ts`): someone else's record is a 404, never a 403.
- Phone login: the client sends a phone-auth `idToken` to `POST /api/v1/auth/phone/login`; `auth-phone/verifier/PhoneTokenVerifier` turns it into an E.164 number. Only `DevPhoneTokenVerifier` exists (accepts `dev:+905551112233`) and it is opt-in: it is bound only when `AUTH_PHONE_DEV_VERIFIER=true` (local `.env`, e2e; never in production, where the app refuses to boot with it). Without the flag the app refuses to boot until a Firebase verifier is returned from `phone-token-verifier.provider.ts` — fail-closed, never inferred from `NODE_ENV`.
- Account deletion (`DELETE /auth/me`, admin `DELETE /users/:id`) goes only through `UsersService.remove`: one UPDATE anonymizes the user (phone → `deleted:<id>`, email/names/photo/socialId → null, `allergenPreferences` cleared) and soft-deletes it, then the user's products are soft-deleted and the kitchen is scrubbed (name, description, cover, address, coordinates, search text) and soft-deleted in one UPDATE — it is a copy of a hard-deleted address (so the menu and kitchen disappear from `/discover/*`), then addresses are hard-deleted and sessions ended — in that order: anonymize → products → kitchen → addresses → sessions. `JwtStrategy` checks the session on every request, so logout and deletion revoke access tokens immediately.
- `profileCompleted` is derived in `UserMapper.toDomain` (first name + last name + KVKK consent) — never store it.
- Phase specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
- Catalog (Faz 2): one kitchen per user (`/kitchens/me`), its menu under `/kitchens/me/products`; customers read through `/discover/*` only. Kitchen address is a copy of an address-book entry; customers get coordinates rounded to `DISCOVERY_COORD_PRECISION`, never `fullAddress`, and customer-facing distance, pickup/delivery availability and fee are measured from that rounded point (so probing lat/lng cannot recover the exact location). Delivery tiers and weekly hours are jsonb on `kitchen`; `deliveryRadiusKm` and every `searchText` are derived on write — never set them by hand.
- Money is integer kuruş (`priceKurus`, `feeKurus`). Time is `Europe/Istanbul` (`catalog/opening-state.ts`).
- Search text goes through `catalog/fold-turkish.ts` both when stored and when queried; Postgres `lower()` gets İ/I wrong.
- Discovery visibility lives twice and must stay in step: SQL in `discovery/discovery.repository.ts`, TypeScript in `discovery/visibility.ts`.
- Dev seed (`npm run seed:run:relational`) adds categories everywhere and, outside production, three Kadıköy kitchens whose cooks log in with `dev:+905550000101..103`.
