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

## Known gaps against the mobile client

The mobile app (`../sofram-mobile/src/store`) was written against a different
API shape; these are backend work still to do, not bugs in the boilerplate:

- Mobile signs in with **phone + OTP** (`requestOtp` / `verifyOtp`); the boilerplate is email/password-first.
- Mobile expects every response wrapped as `{ data, status, statusCode, message }`; the boilerplate returns bare bodies.
