# Project instructions

Sofram'ın API'si — brocoders/nestjs-boilerplate üzerine kurulu, yalnızca
relational (TypeORM/PostgreSQL) katmanıyla (`app:config` ile MongoDB ve
Facebook auth kaldırıldı). Mobil istemci: `../sofram-mobile`.

## When adding entities, schemas, or properties

Use the `generate` skill (auto-loaded from [.claude/skills/generate/SKILL.md](.claude/skills/generate/SKILL.md)). It documents the project's CLI generators (`npm run generate:resource:relational`, `npm run add:property:to-relational`) which keep DTOs, modules, and migrations in sync. Do not hand-write entity files.

## Local environment

- PostgreSQL 16 from Homebrew on `localhost:5432`, database and role `sofram` (credentials in `.env`, never committed). No Docker.
- Mail goes to maildev: `npx maildev -s 1025 -w 1080`, inbox at <http://localhost:1080>.
- API on `http://localhost:3001`, prefix `/api/v1`, Swagger at `/docs`.
- Seeded users: `admin@example.com` / `secret` (Admin), `john.doe@example.com` / `secret` (User).

## API conventions

- Every response is wrapped by `utils/http/ResponseEnvelopeInterceptor` as `{ data, status, statusCode, message }`; errors go through `utils/http/AllExceptionsFilter` as `{ data: null, status: false, statusCode, message, errors?: { field, message }[] }` (dot paths for nested DTOs). 204 is not wrapped. Keep throwing the boilerplate shape (`new UnprocessableEntityException({ status, errors: { field: 'key' } })`) — the filter flattens it.
- Records that belong to a user are looked up scoped to that user and wrapped in `orNotFound(...)` (`utils/or-not-found.ts`): someone else's record is a 404, never a 403.
- Phone login: the client sends a phone-auth `idToken` to `POST /api/v1/auth/phone/login`; `auth-phone/verifier/PhoneTokenVerifier` turns it into an E.164 number. Only `DevPhoneTokenVerifier` exists (accepts `dev:+905551112233`) and it is opt-in: it is bound only when `AUTH_PHONE_DEV_VERIFIER=true` (local `.env`, e2e; never in production, where the app refuses to boot with it). Without the flag the app refuses to boot until a Firebase verifier is returned from `phone-token-verifier.provider.ts` — fail-closed, never inferred from `NODE_ENV`.
- Account deletion (`DELETE /auth/me`, admin `DELETE /users/:id`) goes only through `UsersService.remove`: one UPDATE anonymizes the user (phone → `deleted:<id>`, email/names/photo/socialId → null) and soft-deletes it, then addresses are hard-deleted and sessions ended. `JwtStrategy` checks the session on every request, so logout and deletion revoke access tokens immediately.
- `profileCompleted` is derived in `UserMapper.toDomain` (first name + last name + KVKK consent) — never store it.
- Phase specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
