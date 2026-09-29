# Faz 1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sofram API'sine yanıt zarfı, telefonla giriş (dev doğrulayıcı), KVKK'lı profil tamamlama, hesap silme ve kullanıcıya ait adres CRUD'unu eklemek.

**Architecture:** NestJS + TypeORM (brocoders boilerplate, hexagonal: `domain/` ↔ `infrastructure/persistence/relational/`). Zarf ve hata formatı global interceptor + exception filter ile tek yerde uygulanır. Telefon doğrulaması `PhoneTokenVerifier` soyut sınıfının arkasındadır; Faz 1'de yalnızca `DevPhoneTokenVerifier` vardır. Yeni entity/alanlar hygen generator'larıyla üretilir, sonra elle özelleştirilir.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL 16 (Homebrew, Docker yok), class-validator, Jest 30 + supertest.

**Spec:** `docs/superpowers/specs/2026-09-30-faz1-temel-design.md` — **§8 "Uygulama notları" tablosu yukarıdaki bölümleri geçersiz kılar** (endpoint yolları oradan okunur).

## Global Constraints

- Yanıt zarfı: `{ data, status: true, statusCode, message: 'OK' }`; hata: `{ data: null, status: false, statusCode, message, errors?: { field, message }[] }`. 204 sarılmaz.
- Endpoint'ler: `POST /api/v1/auth/phone/login`, mevcut `auth/google/login`, `auth/apple/login`, `auth/refresh`, `auth/logout`, `GET|PATCH|DELETE /api/v1/auth/me`, `GET|POST /api/v1/addresses`, `PATCH|DELETE /api/v1/addresses/:id`.
- Dev telefon token'ı: `dev:<E.164>` (ör. `dev:+905551112233`), regex `^dev:(\+[1-9]\d{7,14})$`. Production'da dev doğrulayıcı asla bağlanmaz.
- Başkasının kaydı → **404** (`{ error: 'notFound' }`), 403 değil.
- Entity ve entity alanları **yalnızca** generator ile eklenir (`npm run generate:resource:relational`, `npm run add:property:to-relational`); generator çıktısı sonra elle düzenlenebilir. `id`/`createdAt`/`updatedAt` asla generator'a verilmez.
- Migration'lar elle yazılmaz: `npm run migration:generate -- src/database/migrations/<Ad>` + `npm run migration:run`.
- Commit mesajları conventional commits; konu küçük harfle başlar (commitlint `subject-case`). Husky pre-commit `lint` + `test` çalıştırır. Her commit mesajı şu satırla biter:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Yerel ortam: API `http://localhost:3001` (`npm run start:dev`, watch mode), maildev `npx maildev -s 1025 -w 1080`, Postgres `localhost:5432` db/rol `sofram`.

## File Structure

```
src/utils/http/
  api-response.type.ts               ApiFieldError, ApiEnvelope<T>
  flatten-errors.ts (+ .spec.ts)     iç içe hata ağacı → nokta yollu dizi
  response-envelope.interceptor.ts (+ .spec.ts)
  all-exceptions.filter.ts (+ .spec.ts)
src/utils/or-not-found.ts (+ .spec.ts) null → NotFoundException; Faz 2+ sahiplik kontrolleri de kullanır
src/main.ts                          filtre + interceptor kaydı, Swagger açıklaması
src/users/…                          (generator) phoneNumber, kvkkAcceptedAt, marketingConsent; findByPhoneNumber; türetilmiş profileCompleted
src/auth/auth-providers.enum.ts      + phone, − facebook
src/auth/auth.service.ts (+ .spec.ts) createLoginResponse (tekrar giderme), validatePhoneLogin, update (KVKK), softDelete (anonimleştirme), me (401)
src/auth/dto/auth-update.dto.ts      + kvkkAccepted, marketingConsent
src/auth/dto/phone-login-response.dto.ts  LoginResponseDto + isNewUser
src/auth-phone/                      auth-google ile aynı şekil
  auth-phone.module.ts
  auth-phone.controller.ts
  dto/auth-phone-login.dto.ts
  verifier/phone-token-verifier.ts
  verifier/dev-phone-token-verifier.ts (+ .spec.ts)
  verifier/phone-token-verifier.provider.ts (+ .spec.ts)
src/addresses/                       (generator) + kullanıcı kapsamlı controller/service/repository
src/database/migrations/*            (generate) UserPhoneAuth, CreateAddress
test/user/auth.e2e-spec.ts, test/admin/*.e2e-spec.ts   zarfa uyarlanır
test/user/phone-auth.e2e-spec.ts     yeni uçtan uca akış
CLAUDE.md                            "Known gaps" → "API conventions"
```

---

### Task 0: Başlangıç durumunu doğrula

**Files:** yok (yalnızca doğrulama)

- [ ] **Step 1: Servisleri kontrol et**

Run: `lsof -i :3001 -sTCP:LISTEN; lsof -i :1080 -sTCP:LISTEN; pg_isready`
Expected: 3001'de node (API, `npm run start:dev`), 1080'de maildev, Postgres "accepting connections". API çalışmıyorsa ayrı bir terminalde (arka planda) `npm run start:dev`, maildev yoksa `npx maildev -s 1025 -w 1080` başlat.

- [ ] **Step 2: Mevcut e2e paketini çalıştır**

Run: `npm run test:e2e -- --runInBand`
Expected: PASS (tüm testler yeşil). Kırmızı test varsa DURUP kullanıcıya bildir — başlangıç bozuksa sonraki görevlerin sonucu yorumlanamaz.

---

### Task 1: Yanıt zarfı ve hata formatı

**Files:**
- Create: `src/utils/http/api-response.type.ts`, `src/utils/http/flatten-errors.ts`, `src/utils/http/response-envelope.interceptor.ts`, `src/utils/http/all-exceptions.filter.ts`
- Test: `src/utils/http/flatten-errors.spec.ts`, `src/utils/http/response-envelope.interceptor.spec.ts`, `src/utils/http/all-exceptions.filter.spec.ts`
- Modify: `src/main.ts`, `test/user/auth.e2e-spec.ts`, `test/admin/auth.e2e-spec.ts`, `test/admin/users.e2e-spec.ts`

**Interfaces:**
- Produces: `ApiFieldError = { field: string; message: string }`, `ApiEnvelope<T>`, `ErrorTree`, `flattenErrors(tree: ErrorTree, prefix?: string): ApiFieldError[]`, `ResponseEnvelopeInterceptor`, `AllExceptionsFilter`.

- [ ] **Step 1: Tipleri yaz**

`src/utils/http/api-response.type.ts`:

```ts
export type ApiFieldError = { field: string; message: string };

export type ApiEnvelope<T> = {
  data: T;
  status: boolean;
  statusCode: number;
  message: string;
  errors?: ApiFieldError[];
};
```

- [ ] **Step 2: `flattenErrors` için başarısız testi yaz**

`src/utils/http/flatten-errors.spec.ts`:

```ts
import { flattenErrors } from './flatten-errors';

describe('flattenErrors', () => {
  it('should turn a nested error tree into dot-path field errors', () => {
    expect(
      flattenErrors({
        email: 'notFound',
        address: { district: 'required', geo: { lat: 'isNumber' } },
      }),
    ).toEqual([
      { field: 'email', message: 'notFound' },
      { field: 'address.district', message: 'required' },
      { field: 'address.geo.lat', message: 'isNumber' },
    ]);
  });

  it('should return an empty list for an empty tree', () => {
    expect(flattenErrors({})).toEqual([]);
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `npx jest src/utils/http/flatten-errors.spec.ts`
Expected: FAIL — `Cannot find module './flatten-errors'`.

- [ ] **Step 4: `flattenErrors`'ı yaz**

`src/utils/http/flatten-errors.ts`:

```ts
import { ApiFieldError } from './api-response.type';

/** The boilerplate's error shape: `{ email: 'notFound', address: { district: '…' } }`. */
export type ErrorTree = { [key: string]: string | ErrorTree };

export function flattenErrors(tree: ErrorTree, prefix = ''): ApiFieldError[] {
  const result: ApiFieldError[] = [];

  for (const [key, value] of Object.entries(tree)) {
    const field = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      result.push({ field, message: value });
    } else {
      result.push(...flattenErrors(value, field));
    }
  }

  return result;
}
```

- [ ] **Step 5: Testin geçtiğini gör**

Run: `npx jest src/utils/http/flatten-errors.spec.ts`
Expected: PASS (2 test).

- [ ] **Step 6: Interceptor için başarısız testi yaz**

`src/utils/http/response-envelope.interceptor.spec.ts`:

```ts
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

const contextWithStatus = (statusCode: number) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
  }) as unknown as ExecutionContext;

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

const run = (statusCode: number, body: unknown) =>
  lastValueFrom(
    new ResponseEnvelopeInterceptor().intercept(
      contextWithStatus(statusCode),
      handlerReturning(body),
    ),
  );

describe('ResponseEnvelopeInterceptor', () => {
  it('should wrap the body with status metadata', async () => {
    await expect(run(200, { id: 1 })).resolves.toEqual({
      data: { id: 1 },
      status: true,
      statusCode: 200,
      message: 'OK',
    });
  });

  it('should keep the handler status code (201 for POST)', async () => {
    await expect(run(201, { id: 'a' })).resolves.toMatchObject({
      statusCode: 201,
    });
  });

  it('should turn an empty body into data: null', async () => {
    await expect(run(200, undefined)).resolves.toMatchObject({ data: null });
  });

  it('should not wrap 204 responses', async () => {
    await expect(run(204, undefined)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 7: Testin başarısız olduğunu gör**

Run: `npx jest src/utils/http/response-envelope.interceptor.spec.ts`
Expected: FAIL — modül bulunamadı.

- [ ] **Step 8: Interceptor'ı yaz**

`src/utils/http/response-envelope.interceptor.ts`:

```ts
import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import { ApiEnvelope } from './api-response.type';

/**
 * Registered FIRST in main.ts so it is the outermost interceptor: it sees the
 * body after ClassSerializerInterceptor has applied @Exclude/@Expose groups.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (response.statusCode === Number(HttpStatus.NO_CONTENT)) {
          return body;
        }

        const envelope: ApiEnvelope<unknown> = {
          data: body ?? null,
          status: true,
          statusCode: response.statusCode,
          message: 'OK',
        };

        return envelope;
      }),
    );
  }
}
```

- [ ] **Step 9: Testin geçtiğini gör**

Run: `npx jest src/utils/http/response-envelope.interceptor.spec.ts`
Expected: PASS (4 test).

- [ ] **Step 10: Exception filter için başarısız testi yaz**

`src/utils/http/all-exceptions.filter.spec.ts`:

```ts
import {
  ArgumentsHost,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

const hostCapturing = () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
};

describe('AllExceptionsFilter', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('should flatten boilerplate validation errors into errors[]', () => {
    const { host, status, json } = hostCapturing();

    new AllExceptionsFilter().catch(
      new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { email: 'notFound', address: { district: 'isNotEmpty' } },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      data: null,
      status: false,
      statusCode: 422,
      message: 'Unprocessable Entity Exception',
      errors: [
        { field: 'email', message: 'notFound' },
        { field: 'address.district', message: 'isNotEmpty' },
      ],
    });
  });

  it('should use the boilerplate `error` key as the message', () => {
    const { host, json } = hostCapturing();

    new AllExceptionsFilter().catch(
      new NotFoundException({ status: HttpStatus.NOT_FOUND, error: 'notFound' }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      data: null,
      status: false,
      statusCode: 404,
      message: 'notFound',
    });
  });

  it('should keep Nest default messages', () => {
    const { host, json } = hostCapturing();

    new AllExceptionsFilter().catch(new UnauthorizedException(), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, message: 'Unauthorized' }),
    );
  });

  it('should hide unknown errors behind a generic 500', () => {
    const { host, status, json } = hostCapturing();

    new AllExceptionsFilter().catch(new Error('db password is hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      data: null,
      status: false,
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
```

- [ ] **Step 11: Testin başarısız olduğunu gör**

Run: `npx jest src/utils/http/all-exceptions.filter.spec.ts`
Expected: FAIL — modül bulunamadı.

- [ ] **Step 12: Filter'ı yaz**

`src/utils/http/all-exceptions.filter.ts`:

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

    const body: ApiEnvelope<null> = {
      data: null,
      status: false,
      statusCode,
      message:
        isHttp && statusCode < 500
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

- [ ] **Step 13: Testin geçtiğini gör**

Run: `npx jest src/utils/http`
Expected: PASS (10 test).

- [ ] **Step 14: `main.ts`'e kaydet**

`src/main.ts` — importlara ekle:

```ts
import { AllExceptionsFilter } from './utils/http/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './utils/http/response-envelope.interceptor';
```

`app.useGlobalInterceptors(...)` bloğunu şununla değiştir:

```ts
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    // Outermost: wraps the body after it has been serialized below.
    new ResponseEnvelopeInterceptor(),
    // ResolvePromisesInterceptor is used to resolve promises in responses because class-transformer can't do it
    // https://github.com/typestack/class-transformer/issues/549
    new ResolvePromisesInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
```

Swagger `DocumentBuilder`'da `.setTitle('API').setDescription('API docs')` yerine:

```ts
    .setTitle('Sofram API')
    .setDescription(
      'Her yanıt { data, status, statusCode, message } zarfıyla döner; hatalarda status=false ve doğrulama hatalarında errors: { field, message }[] eklenir. Aşağıdaki şemalar `data` içeriğini gösterir.',
    )
```

- [ ] **Step 15: Mevcut e2e testlerini zarfa uyarla**

Run:

```bash
sed -i '' -E 's/body\.(token|refreshToken|tokenExpires|user|email|provider|password|hash|data)/body.data.\1/g' test/user/auth.e2e-spec.ts test/admin/auth.e2e-spec.ts test/admin/users.e2e-spec.ts
```

Sonra `test/user/auth.e2e-spec.ts` içinde (yaklaşık satır 32) şu satırı:

```ts
          expect(body.errors.email).toBeDefined();
```

şununla değiştir:

```ts
          expect(body.errors).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ field: 'email' }),
            ]),
          );
```

Kontrol: `grep -n "body\.data\.errors\|body\.errors\." test -r` → çıktı boş olmalı. `test/admin/users.e2e-spec.ts` içindeki sayfalı liste artık `body.data.data[0]` olmalı (`grep -n "data\[0\]" test/admin/users.e2e-spec.ts`).

- [ ] **Step 16: Tüm testleri çalıştır**

Run: `npm run lint && npm test && npm run test:e2e -- --runInBand`
Expected: hepsi PASS. (API watch modunda olduğu için `main.ts` değişikliği otomatik yüklenir; emin değilsen `curl -s localhost:3001/api/v1/auth/me` → `{"data":null,"status":false,"statusCode":401,"message":"Unauthorized"}` dönmeli.)

- [ ] **Step 17: Commit**

```bash
git add src/utils/http src/main.ts test
git commit -m "feat(http): wrap responses and errors in the mobile envelope

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Kullanıcı alanları, `findByPhoneNumber`, türetilmiş `profileCompleted`

**Files:**
- Generate/Modify: `src/users/domain/user.ts`, `src/users/dto/create-user.dto.ts`, `src/users/infrastructure/persistence/relational/entities/user.entity.ts`, `src/users/infrastructure/persistence/relational/mappers/user.mapper.ts`, `src/users/users.service.ts`
- Modify: `src/users/infrastructure/persistence/user.repository.ts`, `src/users/infrastructure/persistence/relational/repositories/user.repository.ts`, `src/auth/auth-providers.enum.ts`
- Test: `src/users/infrastructure/persistence/relational/mappers/user.mapper.spec.ts`
- Create (generate): `src/database/migrations/<timestamp>-UserPhoneAuth.ts`

**Interfaces:**
- Produces: `User.phoneNumber?: string | null`, `User.kvkkAcceptedAt?: Date | null`, `User.marketingConsent?: boolean`, `User.profileCompleted?: boolean` (yalnızca okunur, mapper doldurur), `UsersService.findByPhoneNumber(phoneNumber: string): Promise<NullableType<User>>`, `AuthProvidersEnum.phone = 'phone'`.

- [ ] **Step 1: Generator ile alanları ekle (sırayla, tek tek)**

```bash
npm run add:property:to-relational -- --name User --property phoneNumber --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name User --property kvkkAcceptedAt --kind primitive --type Date --isAddToDto false --isOptional true --isNullable true
npm run add:property:to-relational -- --name User --property marketingConsent --kind primitive --type boolean --isAddToDto true --isOptional true --isNullable false
```

`isAddToDto false` → domain'de `@Exclude({ toPlainOnly: true })` üretir: `kvkkAcceptedAt` yanıtlarda görünmez (istemci `profileCompleted`'ı okur) ve istekten set edilemez (`whitelist`).

- [ ] **Step 2: Generator çıktısını düzelt**

`user.entity.ts` — üç sütunu şu hale getir (generator'ın ürettiği dekoratörleri değiştir):

```ts
  @Column({ type: String, nullable: true, unique: true })
  phoneNumber?: string | null;

  @Column({ type: Date, nullable: true })
  kvkkAcceptedAt?: Date | null;

  @Column({ type: Boolean, default: false })
  marketingConsent?: boolean;
```

`src/users/domain/user.ts` — `phoneNumber` üzerindeki `@ApiProperty(...)` korunur, altına email'deki gibi grup kısıtı eklenir (import'ta `Expose` zaten var):

```ts
  @Expose({ groups: ['me', 'admin'] })
  phoneNumber?: string | null;
```

Aynı dosyada, `lastName` alanının altına türetilmiş alanı ekle:

```ts
  /** Derived in UserMapper.toDomain — never persisted. */
  @ApiProperty({ type: Boolean })
  profileCompleted?: boolean;
```

`src/auth/auth-providers.enum.ts`:

```ts
export enum AuthProvidersEnum {
  email = 'email',
  phone = 'phone',
  google = 'google',
  apple = 'apple',
}
```

- [ ] **Step 3: Mapper için başarısız testi yaz**

`src/users/infrastructure/persistence/relational/mappers/user.mapper.spec.ts`:

```ts
import { UserEntity } from '../entities/user.entity';
import { UserMapper } from './user.mapper';

const entity = (overrides: Partial<UserEntity>): UserEntity =>
  Object.assign(new UserEntity(), {
    id: 1,
    email: null,
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    kvkkAcceptedAt: new Date('2026-09-30T10:00:00Z'),
    ...overrides,
  });

describe('UserMapper.toDomain profileCompleted', () => {
  it('should be true with first name, last name and KVKK consent', () => {
    expect(UserMapper.toDomain(entity({})).profileCompleted).toBe(true);
  });

  it.each([
    ['first name', { firstName: null }],
    ['last name', { lastName: null }],
    ['KVKK consent', { kvkkAcceptedAt: null }],
  ])('should be false without %s', (_label, overrides) => {
    expect(UserMapper.toDomain(entity(overrides)).profileCompleted).toBe(false);
  });
});
```

- [ ] **Step 4: Testin başarısız olduğunu gör**

Run: `npx jest src/users`
Expected: FAIL — `profileCompleted` `undefined`, `true` beklenirken.

- [ ] **Step 5: Mapper'da türet**

`user.mapper.ts` → `toDomain` içinde `return domainEntity;` satırının hemen üstüne:

```ts
    domainEntity.profileCompleted = Boolean(
      raw.firstName && raw.lastName && raw.kvkkAcceptedAt,
    );
```

Run: `npx jest src/users`
Expected: PASS (4 test).

- [ ] **Step 6: `findByPhoneNumber` ekle**

`src/users/infrastructure/persistence/user.repository.ts` — `findByEmail` satırının altına:

```ts
  abstract findByPhoneNumber(
    phoneNumber: NonNullable<User['phoneNumber']>,
  ): Promise<NullableType<User>>;
```

`src/users/infrastructure/persistence/relational/repositories/user.repository.ts` — `findByEmail` metodunun altına:

```ts
  async findByPhoneNumber(
    phoneNumber: NonNullable<User['phoneNumber']>,
  ): Promise<NullableType<User>> {
    const entity = await this.usersRepository.findOne({
      where: { phoneNumber },
    });

    return entity ? UserMapper.toDomain(entity) : null;
  }
```

`src/users/users.service.ts` — `findByEmail` metodunun altına:

```ts
  findByPhoneNumber(
    phoneNumber: NonNullable<User['phoneNumber']>,
  ): Promise<NullableType<User>> {
    return this.usersRepository.findByPhoneNumber(phoneNumber);
  }
```

- [ ] **Step 7: Migration üret ve uygula**

```bash
npm run migration:generate -- src/database/migrations/UserPhoneAuth
```

Üretilen dosyayı aç ve yalnızca şunları içerdiğini doğrula: `user` tablosuna `phoneNumber` (varchar, null, UNIQUE constraint), `kvkkAcceptedAt` (timestamp, null), `marketingConsent` (boolean NOT NULL DEFAULT false). Başka tablo/sütun değişikliği varsa DUR ve raporla (şema kayması demektir).

```bash
npm run migration:run
```

Expected: `Migration UserPhoneAuth… has been executed successfully.`

- [ ] **Step 8: Doğrula**

Run: `npm run lint && npm run build && npm test && npm run test:e2e -- --runInBand`
Expected: hepsi PASS.

- [ ] **Step 9: Commit**

```bash
git add src/users src/auth/auth-providers.enum.ts src/database/migrations
git commit -m "feat(users): add phone number, KVKK consent and marketing consent

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Telefonla giriş (`POST /api/v1/auth/phone/login`)

**Files:**
- Modify: `src/auth/auth.service.ts`, `src/app.module.ts`
- Create: `src/auth-phone/auth-phone.module.ts`, `src/auth-phone/auth-phone.controller.ts`, `src/auth-phone/dto/auth-phone-login.dto.ts`, `src/auth/dto/phone-login-response.dto.ts`, `src/auth-phone/verifier/phone-token-verifier.ts`, `src/auth-phone/verifier/dev-phone-token-verifier.ts`, `src/auth-phone/verifier/phone-token-verifier.provider.ts`
- Test: `src/auth/auth.service.spec.ts`, `src/auth-phone/verifier/dev-phone-token-verifier.spec.ts`, `src/auth-phone/verifier/phone-token-verifier.provider.spec.ts`

**Interfaces:**
- Consumes: `UsersService.findByPhoneNumber`, `AuthProvidersEnum.phone` (Task 2).
- Produces: `PhoneTokenVerifier` (abstract class, `verify(idToken: string): Promise<VerifiedPhone>`), `VerifiedPhone = { phoneNumber: string }`, `AuthService.validatePhoneLogin(phoneNumber: string): Promise<PhoneLoginResponseDto>`, `PhoneLoginResponseDto = LoginResponseDto & { isNewUser: boolean }`, `AuthService` içinde private `createLoginResponse(user: User): Promise<LoginResponseDto>`.

- [ ] **Step 1: Dev doğrulayıcı için başarısız testi yaz**

`src/auth-phone/verifier/dev-phone-token-verifier.spec.ts`:

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import { DevPhoneTokenVerifier } from './dev-phone-token-verifier';

describe('DevPhoneTokenVerifier', () => {
  const verifier = new DevPhoneTokenVerifier();

  it('should extract the E.164 number from a dev token', async () => {
    await expect(verifier.verify('dev:+905551112233')).resolves.toEqual({
      phoneNumber: '+905551112233',
    });
  });

  it.each(['+905551112233', 'dev:05551112233', 'dev:+0555', 'firebase-token'])(
    'should reject %s',
    async (token) => {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    },
  );
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `npx jest src/auth-phone`
Expected: FAIL — modül bulunamadı.

- [ ] **Step 3: Soyut doğrulayıcı ve dev implementasyonu**

`src/auth-phone/verifier/phone-token-verifier.ts`:

```ts
export type VerifiedPhone = { phoneNumber: string };

/**
 * Turns the client's phone-auth token into a verified E.164 number. Firebase
 * Phone Auth plugs in here (firebase-admin → verifyIdToken → phone_number);
 * nothing else in the login flow changes.
 */
export abstract class PhoneTokenVerifier {
  abstract verify(idToken: string): Promise<VerifiedPhone>;
}
```

`src/auth-phone/verifier/dev-phone-token-verifier.ts`:

```ts
import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PhoneTokenVerifier, VerifiedPhone } from './phone-token-verifier';

const DEV_TOKEN = /^dev:(\+[1-9]\d{7,14})$/;

/** Accepts `dev:<E.164>` — what the mobile dev PhoneAuthService sends. Never bound in production. */
@Injectable()
export class DevPhoneTokenVerifier extends PhoneTokenVerifier {
  verify(idToken: string): Promise<VerifiedPhone> {
    const match = DEV_TOKEN.exec(idToken);

    if (!match) {
      return Promise.reject(
        new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { idToken: 'invalidPhoneToken' },
        }),
      );
    }

    return Promise.resolve({ phoneNumber: match[1] });
  }
}
```

Run: `npx jest src/auth-phone/verifier/dev-phone-token-verifier.spec.ts`
Expected: PASS (5 test).

- [ ] **Step 4: Provider için başarısız testi yaz**

`src/auth-phone/verifier/phone-token-verifier.provider.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPhoneTokenVerifier } from './dev-phone-token-verifier';
import { createPhoneTokenVerifier } from './phone-token-verifier.provider';

const configWithEnv = (nodeEnv: string) =>
  ({
    getOrThrow: () => nodeEnv,
  }) as unknown as ConfigService<AllConfigType>;

describe('createPhoneTokenVerifier', () => {
  it('should bind the dev verifier outside production', () => {
    expect(createPhoneTokenVerifier(configWithEnv('development'))).toBeInstanceOf(
      DevPhoneTokenVerifier,
    );
  });

  it('should refuse to boot production without a real verifier', () => {
    expect(() => createPhoneTokenVerifier(configWithEnv('production'))).toThrow(
      /no production verifier/,
    );
  });
});
```

- [ ] **Step 5: Provider'ı yaz**

`src/auth-phone/verifier/phone-token-verifier.provider.ts`:

```ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPhoneTokenVerifier } from './dev-phone-token-verifier';
import { PhoneTokenVerifier } from './phone-token-verifier';

export const createPhoneTokenVerifier = (
  config: ConfigService<AllConfigType>,
): PhoneTokenVerifier => {
  if (config.getOrThrow('app.nodeEnv', { infer: true }) === 'production') {
    // Return a FirebasePhoneTokenVerifier here once firebase-admin is wired in.
    throw new Error('PhoneTokenVerifier: no production verifier configured');
  }

  return new DevPhoneTokenVerifier();
};

export const phoneTokenVerifierProvider: Provider = {
  provide: PhoneTokenVerifier,
  inject: [ConfigService],
  useFactory: createPhoneTokenVerifier,
};
```

Run: `npx jest src/auth-phone`
Expected: PASS (7 test).

- [ ] **Step 6: `AuthService.validatePhoneLogin` için başarısız testi yaz**

`src/auth/auth.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AllConfigType } from '../config/config.type';
import { MailService } from '../mail/mail.service';
import { SessionService } from '../session/session.service';
import { User } from '../users/domain/user';
import { UsersService } from '../users/users.service';
import { AuthProvidersEnum } from './auth-providers.enum';
import { AuthService } from './auth.service';

const CONFIG: Record<string, string> = {
  'auth.expires': '15m',
  'auth.secret': 'secret',
  'auth.refreshSecret': 'refresh-secret',
  'auth.refreshExpires': '3650d',
};

const aUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: 7,
    phoneNumber: '+905551112233',
    role: { id: 2 },
    ...overrides,
  });

export const buildAuthService = () => {
  const users = {
    findByPhoneNumber: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue({ id: 99 }),
    deleteByUserId: jest.fn(),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };
  const config = { getOrThrow: (key: string) => CONFIG[key] };

  const service = new AuthService(
    jwt as unknown as JwtService,
    users as unknown as UsersService,
    sessions as unknown as SessionService,
    {} as MailService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, users, sessions };
};

describe('AuthService.validatePhoneLogin', () => {
  it('should log an existing user in without creating one', async () => {
    const { service, users, sessions } = buildAuthService();
    users.findByPhoneNumber.mockResolvedValue(aUser());

    const result = await service.validatePhoneLogin('+905551112233');

    expect(users.create).not.toHaveBeenCalled();
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 7 }) }),
    );
    expect(result).toMatchObject({
      isNewUser: false,
      token: 'signed.jwt',
      refreshToken: 'signed.jwt',
      user: { id: 7 },
    });
    expect(result.tokenExpires).toBeGreaterThan(Date.now());
  });

  it('should create a nameless phone user on first sight', async () => {
    const { service, users } = buildAuthService();
    users.findByPhoneNumber.mockResolvedValue(null);
    users.create.mockResolvedValue(aUser({ id: 8 }));
    users.findById.mockResolvedValue(aUser({ id: 8 }));

    const result = await service.validatePhoneLogin('+905551112233');

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: '+905551112233',
        provider: AuthProvidersEnum.phone,
        firstName: null,
        lastName: null,
        email: null,
      }),
    );
    expect(result).toMatchObject({ isNewUser: true, user: { id: 8 } });
  });
});
```

Run: `npx jest src/auth/auth.service.spec.ts`
Expected: FAIL — `service.validatePhoneLogin is not a function`.

- [ ] **Step 7: Tekrarı gider ve `validatePhoneLogin`'i ekle**

`src/auth/auth.service.ts`:

1. `validateLogin` içinde parola doğrulandıktan sonraki bloğun tamamını (`const hash = crypto...` satırından `return { refreshToken, token, tokenExpires, user };` dahil) şununla değiştir:

```ts
    return this.createLoginResponse(user);
```

2. `validateSocialLogin` içinde `if (!user) { throw … }` bloğundan sonraki her şeyi (aynı `hash` / `session` / `getTokensData` / `return` bloğu) şununla değiştir:

```ts
    return this.createLoginResponse(user);
```

3. `validateSocialLogin` metodunun hemen altına ekle:

```ts
  async validatePhoneLogin(
    phoneNumber: string,
  ): Promise<PhoneLoginResponseDto> {
    const existing = await this.usersService.findByPhoneNumber(phoneNumber);
    let user = existing;

    if (!user) {
      const created = await this.usersService.create({
        phoneNumber,
        email: null,
        firstName: null,
        lastName: null,
        provider: AuthProvidersEnum.phone,
        role: { id: RoleEnum.user },
        status: { id: StatusEnum.active },
      });
      // Re-read so role/status/photo come back eagerly loaded, as in social login.
      user = await this.usersService.findById(created.id);
    }

    if (!user) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { user: 'userNotFound' },
      });
    }

    return {
      ...(await this.createLoginResponse(user)),
      isNewUser: !existing,
    };
  }
```

4. `getTokensData`'nın hemen üstüne private yardımcıyı ekle:

```ts
  private async createLoginResponse(user: User): Promise<LoginResponseDto> {
    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.create({ user, hash });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
    });

    return { refreshToken, token, tokenExpires, user };
  }
```

5. Import ekle: `import { PhoneLoginResponseDto } from './dto/phone-login-response.dto';`

`src/auth/dto/phone-login-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { LoginResponseDto } from './login-response.dto';

export class PhoneLoginResponseDto extends LoginResponseDto {
  @ApiProperty({ description: 'true: bu numara ilk kez görüldü, kullanıcı yeni oluşturuldu' })
  isNewUser: boolean;
}
```

Run: `npx jest src/auth`
Expected: PASS (2 test).

- [ ] **Step 8: Controller, DTO ve modül**

`src/auth-phone/dto/auth-phone-login.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AuthPhoneLoginDto {
  @ApiProperty({ example: 'dev:+905551112233' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
```

`src/auth-phone/auth-phone.controller.ts`:

```ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthPhoneLoginDto } from './dto/auth-phone-login.dto';
import { PhoneLoginResponseDto } from '../auth/dto/phone-login-response.dto';
import { PhoneTokenVerifier } from './verifier/phone-token-verifier';

@ApiTags('Auth')
@Controller({
  path: 'auth/phone',
  version: '1',
})
export class AuthPhoneController {
  constructor(
    private readonly authService: AuthService,
    private readonly phoneTokenVerifier: PhoneTokenVerifier,
  ) {}

  @ApiOkResponse({
    type: PhoneLoginResponseDto,
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: AuthPhoneLoginDto,
  ): Promise<PhoneLoginResponseDto> {
    const { phoneNumber } = await this.phoneTokenVerifier.verify(
      loginDto.idToken,
    );

    return this.authService.validatePhoneLogin(phoneNumber);
  }
}
```

`src/auth-phone/auth-phone.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AuthPhoneController } from './auth-phone.controller';
import { phoneTokenVerifierProvider } from './verifier/phone-token-verifier.provider';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [phoneTokenVerifierProvider],
  controllers: [AuthPhoneController],
})
export class AuthPhoneModule {}
```

`src/app.module.ts`: `import { AuthPhoneModule } from './auth-phone/auth-phone.module';` ekle ve `imports` dizisinde `AuthAppleModule,` satırının altına `AuthPhoneModule,` yaz.

- [ ] **Step 9: Canlı dene**

Run:

```bash
curl -s -X POST localhost:3001/api/v1/auth/phone/login -H 'Content-Type: application/json' -d '{"idToken":"dev:+905550000001"}' | head -c 400; echo
curl -s -X POST localhost:3001/api/v1/auth/phone/login -H 'Content-Type: application/json' -d '{"idToken":"nope"}'; echo
```

Expected: ilki `{"data":{"refreshToken":"…","token":"…","tokenExpires":…,"user":{…"phoneNumber":"+905550000001"…,"profileCompleted":false…},"isNewUser":true},"status":true,"statusCode":200,"message":"OK"}`; ikincisi `{"data":null,"status":false,"statusCode":422,…,"errors":[{"field":"idToken","message":"invalidPhoneToken"}]}`.

- [ ] **Step 10: Doğrula ve commit**

Run: `npm run lint && npm run build && npm test && npm run test:e2e -- --runInBand`
Expected: hepsi PASS (email ve sosyal giriş e2e'leri refactor sonrası da yeşil).

```bash
git add src/auth src/auth-phone src/app.module.ts
git commit -m "feat(auth): phone login behind a swappable PhoneTokenVerifier

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Profil tamamlama (KVKK), hesap silme, silinmiş kullanıcıya 401

**Files:**
- Modify: `src/auth/dto/auth-update.dto.ts`, `src/auth/auth.service.ts`
- Test: `src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `User.kvkkAcceptedAt`, `User.marketingConsent`, `User.phoneNumber` (Task 2); `buildAuthService` test yardımcısı (Task 3).
- Produces: `PATCH /api/v1/auth/me` gövdesinde `kvkkAccepted?: boolean`, `marketingConsent?: boolean`; `DELETE /api/v1/auth/me` → telefon `deleted:<id>`, email `null`, tüm session'lar silinir, soft delete; `GET /api/v1/auth/me` silinmiş/olmayan kullanıcıda 401.

- [ ] **Step 1: Başarısız testleri ekle**

`src/auth/auth.service.spec.ts` sonuna ekle:

```ts
describe('AuthService.update', () => {
  const payload = { id: 7, role: { id: 2 }, sessionId: 99, iat: 0, exp: 0 };

  it('should stamp KVKK consent once and pass marketing consent through', async () => {
    const { service, users } = buildAuthService();
    users.findById.mockResolvedValue(aUser({ kvkkAcceptedAt: null }));

    await service.update(payload, {
      firstName: 'Ayşe',
      kvkkAccepted: true,
      marketingConsent: true,
    });

    expect(users.update).toHaveBeenCalledWith(7, {
      firstName: 'Ayşe',
      marketingConsent: true,
      kvkkAcceptedAt: expect.any(Date),
    });
  });

  it('should not move an existing KVKK timestamp', async () => {
    const { service, users } = buildAuthService();
    users.findById.mockResolvedValue(
      aUser({ kvkkAcceptedAt: new Date('2026-01-01') }),
    );

    await service.update(payload, { kvkkAccepted: true });

    expect(users.update).toHaveBeenCalledWith(7, { kvkkAcceptedAt: undefined });
  });
});

describe('AuthService.softDelete', () => {
  it('should free the phone number and email, drop sessions, then soft delete', async () => {
    const { service, users, sessions } = buildAuthService();
    const payload = { id: 7, role: { id: 2 }, sessionId: 99, iat: 0, exp: 0 };

    await service.softDelete(payload);

    expect(users.update).toHaveBeenCalledWith(7, {
      phoneNumber: 'deleted:7',
      email: null,
    });
    expect(sessions.deleteByUserId).toHaveBeenCalledWith({ userId: 7 });
    expect(users.remove).toHaveBeenCalledWith(7);
  });
});

describe('AuthService.me', () => {
  it('should reject a token whose user no longer exists', async () => {
    const { service, users } = buildAuthService();
    users.findById.mockResolvedValue(null);

    await expect(
      service.me({ id: 7, role: { id: 2 }, sessionId: 99, iat: 0, exp: 0 }),
    ).rejects.toThrow('Unauthorized');
  });
});
```

Run: `npx jest src/auth/auth.service.spec.ts`
Expected: FAIL — `kvkkAccepted` DTO'da yok (TS hatası) ve `softDelete`/`me` beklentileri tutmuyor.

- [ ] **Step 2: DTO'yu genişlet**

`src/auth/dto/auth-update.dto.ts` — `IsBoolean`'ı class-validator importuna ekle, sınıfın sonuna:

```ts
  @ApiPropertyOptional({
    description: 'true gönderildiğinde KVKK onay zamanı (ilk kez) kaydedilir',
  })
  @IsOptional()
  @IsBoolean()
  kvkkAccepted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
```

- [ ] **Step 3: Servisi güncelle**

`src/auth/auth.service.ts`:

`me` metodunu şununla değiştir:

```ts
  async me(userJwtPayload: JwtPayloadType): Promise<User> {
    const user = await this.usersService.findById(userJwtPayload.id);

    // Access tokens are stateless; a deleted account must still stop here.
    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
```

`update` metodunun sonundaki:

```ts
    delete userDto.email;
    delete userDto.oldPassword;

    await this.usersService.update(userJwtPayload.id, userDto);
```

bloğunu şununla değiştir:

```ts
    const { kvkkAccepted, ...changes } = userDto;
    delete changes.email;
    delete changes.oldPassword;

    await this.usersService.update(userJwtPayload.id, {
      ...changes,
      kvkkAcceptedAt:
        kvkkAccepted && !currentUser.kvkkAcceptedAt ? new Date() : undefined,
    });
```

`softDelete` metodunu şununla değiştir:

```ts
  async softDelete(userJwtPayload: JwtPayloadType): Promise<void> {
    // phoneNumber and email are UNIQUE and soft-deleted rows keep them, so free
    // both before deleting — otherwise the same person can never sign up again.
    await this.usersService.update(userJwtPayload.id, {
      phoneNumber: `deleted:${userJwtPayload.id}`,
      email: null,
    });
    await this.sessionService.deleteByUserId({ userId: userJwtPayload.id });
    await this.usersService.remove(userJwtPayload.id);
  }
```

`AuthController.me`'nin dönüş tipi `Promise<NullableType<User>>` olarak kalabilir (User, NullableType<User>'a atanabilir).

Run: `npx jest src/auth`
Expected: PASS (6 test).

- [ ] **Step 4: Doğrula ve commit**

Run: `npm run lint && npm run build && npm test && npm run test:e2e -- --runInBand`
Expected: hepsi PASS.

```bash
git add src/auth
git commit -m "feat(auth): record KVKK consent on profile update, anonymize deleted accounts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Adresler (`/api/v1/addresses`)

**Files:**
- Generate: `src/addresses/**` (resource + alanlar), `src/app.module.ts` (generator enjekte eder)
- Create: `src/utils/or-not-found.ts`, `src/utils/or-not-found.spec.ts`, `src/addresses/addresses.service.spec.ts`
- Modify (generator sonrası): `src/addresses/addresses.controller.ts`, `src/addresses/addresses.service.ts`, `src/addresses/addresses.module.ts`, `src/addresses/infrastructure/persistence/address.repository.ts`, `src/addresses/infrastructure/persistence/relational/repositories/address.repository.ts`, `src/addresses/infrastructure/persistence/relational/entities/address.entity.ts`, `src/addresses/dto/create-address.dto.ts`
- Create (generate): `src/database/migrations/<timestamp>-CreateAddress.ts`

**Interfaces:**
- Consumes: `User` domain, `JwtPayloadType`, `RequestWithUser`.
- Produces: `orNotFound<T>(lookup: Promise<T | null>): Promise<T>` (Faz 2+ sahiplik kontrolleri de kullanır); `Address` domain: `{ id: string; title: string; fullAddress: string; district: string; neighborhood: string; buildingNo?: string | null; floor?: string | null; apartmentNo?: string | null; directions?: string | null; latitude: number; longitude: number; isDefault?: boolean; createdAt: Date; updatedAt: Date }`; REST: `GET /addresses` → `Address[]` (varsayılan önce, sonra en yeni), `POST /addresses` → 201 `Address`, `PATCH /addresses/:id` → `Address`, `DELETE /addresses/:id` → 204.

- [ ] **Step 1: `orNotFound` — test, sonra kod**

`src/utils/or-not-found.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { orNotFound } from './or-not-found';

describe('orNotFound', () => {
  it('should pass a found value through', async () => {
    await expect(orNotFound(Promise.resolve({ id: 1 }))).resolves.toEqual({
      id: 1,
    });
  });

  it('should turn null into a 404', async () => {
    await expect(orNotFound(Promise.resolve(null))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Run: `npx jest src/utils/or-not-found.spec.ts` → FAIL (modül yok).

`src/utils/or-not-found.ts`:

```ts
import { HttpStatus, NotFoundException } from '@nestjs/common';

/**
 * Ownership checks look records up scoped to the caller and use this, so a
 * record that belongs to someone else is indistinguishable from a missing one.
 */
export async function orNotFound<T>(lookup: Promise<T | null>): Promise<T> {
  const value = await lookup;

  if (value === null) {
    throw new NotFoundException({
      status: HttpStatus.NOT_FOUND,
      error: 'notFound',
    });
  }

  return value;
}
```

Run: `npx jest src/utils/or-not-found.spec.ts` → PASS (2 test).

- [ ] **Step 2: Resource'u ve alanları generator ile üret (sırayla)**

```bash
npm run generate:resource:relational -- --name Address
npm run add:property:to-relational -- --name Address --property title --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Address --property fullAddress --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Address --property district --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Address --property neighborhood --kind primitive --type string --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Address --property buildingNo --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Address --property floor --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Address --property apartmentNo --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Address --property directions --kind primitive --type string --isAddToDto true --isOptional true --isNullable true
npm run add:property:to-relational -- --name Address --property latitude --kind primitive --type number --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Address --property longitude --kind primitive --type number --isAddToDto true --isOptional false
npm run add:property:to-relational -- --name Address --property isDefault --kind primitive --type boolean --isAddToDto true --isOptional true --isNullable false
npm run add:property:to-relational -- --name Address --property user --kind reference --type User --referenceType manyToOne --isAddToDto false --isOptional false --shouldAutoLoad false
```

Kontrol: `git status` → `src/addresses/` yeni, `src/app.module.ts` değişmiş (`AddressesModule` eklenmiş).

- [ ] **Step 3: Entity sütunlarını düzelt**

`address.entity.ts` — generator'ın ürettiği üç sütunu/ilişkiyi şu hale getir (import'a `Index` ekle):

```ts
  @Index()
  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  user?: UserEntity;

  @Column({ type: Boolean, default: false })
  isDefault?: boolean;

  // `Number` maps to integer in Postgres; coordinates need double precision
  // (returned as a JS number, unlike `numeric` which comes back as a string).
  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;
```

- [ ] **Step 4: DTO doğrulamasını sıkılaştır**

`create-address.dto.ts` — class-validator importuna `IsNotEmpty, Max, Min` ekle; zorunlu dört string alanın (`title`, `fullAddress`, `district`, `neighborhood`) her birinde `@IsString()`'in altına `@IsNotEmpty()` ekle; koordinatlarda `@IsNumber()`'ın altına:

```ts
  // latitude
  @Min(-90)
  @Max(90)

  // longitude
  @Min(-180)
  @Max(180)
```

(`user?: UserDto` alanı dekoratörsüz kalır; `whitelist: true` istekte onu atar.)

- [ ] **Step 5: Repository sözleşmesini kullanıcı kapsamına çevir**

`src/addresses/infrastructure/persistence/address.repository.ts` — dosyanın tamamı:

```ts
import { DeepPartial } from '../../../utils/types/deep-partial.type';
import { NullableType } from '../../../utils/types/nullable.type';
import { User } from '../../../users/domain/user';
import { Address } from '../../domain/address';

export abstract class AddressRepository {
  abstract create(
    data: Omit<Address, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Address>;

  /** Default first, then newest first. */
  abstract findByUserId(userId: User['id']): Promise<Address[]>;

  abstract countByUserId(userId: User['id']): Promise<number>;

  abstract findOwned(
    userId: User['id'],
    id: Address['id'],
  ): Promise<NullableType<Address>>;

  abstract update(
    id: Address['id'],
    payload: DeepPartial<Address>,
  ): Promise<Address | null>;

  /** Makes `id` the user's only default, atomically. */
  abstract setDefault(userId: User['id'], id: Address['id']): Promise<void>;

  abstract remove(id: Address['id']): Promise<void>;
}
```

`relational/repositories/address.repository.ts` — `findAllWithPagination` ve `findByIds` metodlarını sil (ve kullanılmayan `In`, `IPaginationOptions` importlarını), `create`/`update`/`remove` aynen kalır; şunları ekle (import: `import { User } from '../../../../../users/domain/user';`):

```ts
  async findByUserId(userId: User['id']): Promise<Address[]> {
    const entities = await this.addressRepository.find({
      where: { user: { id: Number(userId) } },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });

    return entities.map((entity) => AddressMapper.toDomain(entity));
  }

  countByUserId(userId: User['id']): Promise<number> {
    return this.addressRepository.count({
      where: { user: { id: Number(userId) } },
    });
  }

  async findOwned(
    userId: User['id'],
    id: Address['id'],
  ): Promise<NullableType<Address>> {
    const entity = await this.addressRepository.findOne({
      where: { id, user: { id: Number(userId) } },
    });

    return entity ? AddressMapper.toDomain(entity) : null;
  }

  async setDefault(userId: User['id'], id: Address['id']): Promise<void> {
    await this.addressRepository.manager.transaction(async (manager) => {
      // Quoted: Postgres folds unquoted identifiers to lower case.
      await manager
        .createQueryBuilder()
        .update(AddressEntity)
        .set({ isDefault: false })
        .where('"userId" = :userId', { userId })
        .execute();

      await manager
        .createQueryBuilder()
        .update(AddressEntity)
        .set({ isDefault: true })
        .where('id = :id AND "userId" = :userId', { id, userId })
        .execute();
    });
  }
```

- [ ] **Step 6: Servis için başarısız testleri yaz (bellek içi sahte repository ile)**

`src/addresses/addresses.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DeepPartial } from '../utils/types/deep-partial.type';
import { User } from '../users/domain/user';
import { AddressesService } from './addresses.service';
import { Address } from './domain/address';
import { CreateAddressDto } from './dto/create-address.dto';
import { AddressRepository } from './infrastructure/persistence/address.repository';

type Row = Address & { ownerId: User['id'] };

class InMemoryAddressRepository extends AddressRepository {
  rows: Row[] = [];
  private clock = 0;

  create(data: Omit<Address, 'id' | 'createdAt' | 'updatedAt'>) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++));
    const row = Object.assign(new Address(), data, {
      id: randomUUID(),
      createdAt: at,
      updatedAt: at,
      ownerId: data.user!.id,
    }) as Row;
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByUserId(userId: User['id']) {
    return Promise.resolve(
      this.rows
        .filter((r) => r.ownerId === userId)
        .sort(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        ),
    );
  }

  countByUserId(userId: User['id']) {
    return Promise.resolve(this.rows.filter((r) => r.ownerId === userId).length);
  }

  findOwned(userId: User['id'], id: string) {
    return Promise.resolve(
      this.rows.find((r) => r.id === id && r.ownerId === userId) ?? null,
    );
  }

  update(id: string, payload: DeepPartial<Address>) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, payload);
    return Promise.resolve(row);
  }

  setDefault(userId: User['id'], id: string) {
    for (const r of this.rows.filter((row) => row.ownerId === userId)) {
      r.isDefault = r.id === id;
    }
    return Promise.resolve();
  }

  remove(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
    return Promise.resolve();
  }
}

const dto = (title: string, extra: Partial<CreateAddressDto> = {}) =>
  ({
    title,
    fullAddress: 'Caferağa Mh. Moda Cd. No:1',
    district: 'Kadıköy',
    neighborhood: 'Caferağa',
    latitude: 40.98,
    longitude: 29.02,
    ...extra,
  }) as CreateAddressDto;

describe('AddressesService', () => {
  let repo: InMemoryAddressRepository;
  let service: AddressesService;
  const ME = 1;
  const SOMEONE_ELSE = 2;

  beforeEach(() => {
    repo = new InMemoryAddressRepository();
    service = new AddressesService(repo);
  });

  it('should make the first address the default', async () => {
    const first = await service.create(ME, dto('Ev'));
    expect(first.isDefault).toBe(true);
  });

  it('should keep the current default unless the new one asks for it', async () => {
    const home = await service.create(ME, dto('Ev'));
    const work = await service.create(ME, dto('İş'));
    expect(work.isDefault).toBe(false);

    const gym = await service.create(ME, dto('Spor', { isDefault: true }));

    const list = await service.findAllForUser(ME);
    expect(list.map((a) => a.id)).toEqual([gym.id, work.id, home.id]);
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('should switch the default on update', async () => {
    await service.create(ME, dto('Ev'));
    const work = await service.create(ME, dto('İş'));

    const updated = await service.update(ME, work.id, {
      isDefault: true,
      floor: '3',
    });

    expect(updated).toMatchObject({ isDefault: true, floor: '3' });
    expect((await service.findAllForUser(ME))[0].id).toBe(work.id);
  });

  it('should promote the newest remaining address when the default is removed', async () => {
    const home = await service.create(ME, dto('Ev'));
    await service.create(ME, dto('İş'));
    const gym = await service.create(ME, dto('Spor'));

    await service.remove(ME, home.id);

    const [first] = await service.findAllForUser(ME);
    expect(first).toMatchObject({ id: gym.id, isDefault: true });
  });

  it("should answer 404 for someone else's address", async () => {
    const theirs = await service.create(SOMEONE_ELSE, dto('Ev'));

    await expect(
      service.update(ME, theirs.id, { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(ME, theirs.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.findAllForUser(ME)).toEqual([]);
  });
});
```

Run: `npx jest src/addresses`
Expected: FAIL — `service.create(ME, …)` imzası uyuşmuyor / `findAllForUser` yok.

- [ ] **Step 7: Servisi kullanıcı kapsamlı olarak yeniden yaz**

`src/addresses/addresses.service.ts` — dosyanın tamamı (generator'ın `<creating-property />` işaretleri bu servisten kalkar; bu entity'ye yeni alan eklenirse DTO → domain aktarımı zaten `...dto` ile yapılır):

```ts
import { Injectable } from '@nestjs/common';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { Address } from './domain/address';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressRepository } from './infrastructure/persistence/address.repository';

@Injectable()
export class AddressesService {
  constructor(private readonly addressRepository: AddressRepository) {}

  findAllForUser(userId: User['id']): Promise<Address[]> {
    return this.addressRepository.findByUserId(userId);
  }

  async create(userId: User['id'], dto: CreateAddressDto): Promise<Address> {
    const isFirst = (await this.addressRepository.countByUserId(userId)) === 0;
    const { isDefault, ...fields } = dto;

    const created = await this.addressRepository.create({
      ...fields,
      user: { id: userId } as User,
      isDefault: false,
    });

    if (isFirst || isDefault) {
      await this.addressRepository.setDefault(userId, created.id);
    }

    return this.findOwned(userId, created.id);
  }

  async update(
    userId: User['id'],
    id: Address['id'],
    dto: UpdateAddressDto,
  ): Promise<Address> {
    await this.findOwned(userId, id);
    // isDefault: false is ignored — the default moves by choosing another one.
    const { isDefault, ...fields } = dto;

    await this.addressRepository.update(id, fields);

    if (isDefault) {
      await this.addressRepository.setDefault(userId, id);
    }

    return this.findOwned(userId, id);
  }

  async remove(userId: User['id'], id: Address['id']): Promise<void> {
    const address = await this.findOwned(userId, id);

    await this.addressRepository.remove(id);

    if (address.isDefault) {
      const [newest] = await this.addressRepository.findByUserId(userId);

      if (newest) {
        await this.addressRepository.setDefault(userId, newest.id);
      }
    }
  }

  private findOwned(userId: User['id'], id: Address['id']): Promise<Address> {
    return orNotFound(this.addressRepository.findOwned(userId, id));
  }
}
```

Not: `CreateAddressDto` generator'dan `user?: UserDto` alanını taşır; `...fields` içinde istekten gelmez (whitelist), ama tip olarak varsa `user` sonra açıkça ezildiği için sorun yoktur. `DeepPartial` yüzünden `update(id, fields)` tipi uymazsa `fields` yerine `{ ...fields, user: undefined }` kullan.

Run: `npx jest src/addresses`
Expected: PASS (5 test).

- [ ] **Step 8: Controller'ı kullanıcı kapsamlı olarak yeniden yaz**

`src/addresses/addresses.controller.ts` — dosyanın tamamı:

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
  Patch,
  Post,
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
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { AddressesService } from './addresses.service';
import { Address } from './domain/address';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/** Every route is scoped to the signed-in user; the id comes from the JWT. */
@ApiTags('Addresses')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'addresses',
  version: '1',
})
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ApiOkResponse({ type: Address, isArray: true })
  findAll(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<Address[]> {
    return this.addressesService.findAllForUser(request.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: Address })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() createAddressDto: CreateAddressDto,
  ): Promise<Address> {
    return this.addressesService.create(request.user.id, createAddressDto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: Address })
  update(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAddressDto: UpdateAddressDto,
  ): Promise<Address> {
    return this.addressesService.update(request.user.id, id, updateAddressDto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.addressesService.remove(request.user.id, id);
  }
}
```

`src/addresses/addresses.module.ts` — servis artık `UsersService` kullanmıyor: generator'ın eklediği `UsersModule` importunu ve `imports` dizisindeki `UsersModule,` satırını sil. `src/addresses/dto/find-all-addresses.dto.ts` artık kullanılmıyor: sil.

- [ ] **Step 9: Migration üret ve uygula**

```bash
npm run migration:generate -- src/database/migrations/CreateAddress
```

Dosyayı doğrula: yalnızca `address` tablosu (uuid PK, sütunlar, `latitude`/`longitude` `double precision`, `isDefault` `DEFAULT false`, `userId` FK + index). Başka değişiklik varsa DUR ve raporla.

```bash
npm run migration:run
```

- [ ] **Step 10: Doğrula ve commit**

Run: `npm run lint && npm run build && npm test && npm run test:e2e -- --runInBand`
Expected: hepsi PASS.

```bash
git add src/addresses src/utils/or-not-found.ts src/utils/or-not-found.spec.ts src/app.module.ts src/database/migrations
git commit -m "feat(addresses): user-scoped address book with a single default

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Uçtan uca akış testi + belgeler

**Files:**
- Create: `test/user/phone-auth.e2e-spec.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1–5'teki tüm endpoint'ler.

- [ ] **Step 1: E2E testini yaz**

`test/user/phone-auth.e2e-spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';

describe('Phone auth, profile and addresses', () => {
  const app = APP_URL;
  const phone = `+90555${String(Date.now()).slice(-7)}`;
  let token: string;
  let refreshToken: string;
  let homeId: string;
  let workId: string;

  const login = () =>
    request(app)
      .post('/api/v1/auth/phone/login')
      .send({ idToken: `dev:${phone}` });

  const address = (title: string, extra: Record<string, unknown> = {}) => ({
    title,
    fullAddress: 'Caferağa Mh. Moda Cd. No:1',
    district: 'Kadıköy',
    neighborhood: 'Caferağa',
    latitude: 40.9862,
    longitude: 29.0254,
    ...extra,
  });

  it('should reject a malformed phone token with a field error', () =>
    request(app)
      .post('/api/v1/auth/phone/login')
      .send({ idToken: 'nope' })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: false,
          statusCode: 422,
          errors: [{ field: 'idToken', message: 'invalidPhoneToken' }],
        });
      }));

  it('should create a nameless user on first login', () =>
    login()
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe(true);
        expect(body.data.isNewUser).toBe(true);
        expect(body.data.user).toMatchObject({
          phoneNumber: phone,
          profileCompleted: false,
        });
        expect(body.data.user.kvkkAcceptedAt).toBeUndefined();
        token = body.data.token;
        refreshToken = body.data.refreshToken;
      }));

  it('should log the same number in as an existing user', () =>
    login()
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.isNewUser).toBe(false);
      }));

  it('should complete the profile with KVKK consent', () =>
    request(app)
      .patch('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .send({
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        kvkkAccepted: true,
        marketingConsent: false,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          firstName: 'Ayşe',
          profileCompleted: true,
          marketingConsent: false,
        });
      }));

  it('should reject an invalid address with dot-path errors', () =>
    request(app)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send(address('', { latitude: 200 }))
      .expect(422)
      .expect(({ body }) => {
        const fields = body.errors.map((e: { field: string }) => e.field);
        expect(fields).toEqual(expect.arrayContaining(['title', 'latitude']));
      }));

  it('should make the first address the default', () =>
    request(app)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send(address('Ev'))
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ title: 'Ev', isDefault: true });
        expect(body.data.user).toBeUndefined();
        homeId = body.data.id;
      }));

  it('should move the default when a new address asks for it', async () => {
    const created = await request(app)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send(address('İş', { isDefault: true, floor: '4' }))
      .expect(201);
    workId = created.body.data.id;

    const { body } = await request(app)
      .get('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .expect(200);

    expect(body.data.map((a: { id: string }) => a.id)).toEqual([
      workId,
      homeId,
    ]);
    expect(body.data[0].isDefault).toBe(true);
    expect(body.data[1].isDefault).toBe(false);
  });

  it('should answer 404 for an address that is not mine', () =>
    request(app)
      .patch('/api/v1/addresses/00000000-0000-4000-8000-000000000000')
      .auth(token, { type: 'bearer' })
      .send({ title: 'x' })
      .expect(404));

  it('should promote the remaining address when the default is deleted', async () => {
    await request(app)
      .delete(`/api/v1/addresses/${workId}`)
      .auth(token, { type: 'bearer' })
      .expect(204);

    const { body } = await request(app)
      .get('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .expect(200);

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: homeId, isDefault: true });
  });

  it('should refresh the session', () =>
    request(app)
      .post('/api/v1/auth/refresh')
      .auth(refreshToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.token).toBeDefined();
        token = body.data.token;
        refreshToken = body.data.refreshToken;
      }));

  it('should delete the account and lock the old tokens out', async () => {
    await request(app)
      .delete('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(204);

    await request(app)
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(401);

    await request(app)
      .post('/api/v1/auth/refresh')
      .auth(refreshToken, { type: 'bearer' })
      .expect(401);
  });

  it('should let the same number start over as a new user', () =>
    login()
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.isNewUser).toBe(true);
        expect(body.data.user.profileCompleted).toBe(false);
      }));
});
```

- [ ] **Step 2: Çalıştır**

Run: `npm run test:e2e -- --runInBand test/user/phone-auth.e2e-spec.ts`
Expected: PASS (12 test). Başarısız olan varsa ilgili görevin koduna dön — testi gevşetme.

- [ ] **Step 3: `CLAUDE.md`'yi güncelle**

`CLAUDE.md` içindeki `## Known gaps against the mobile client` bölümünü (başlık dahil, dosya sonuna kadar) şununla değiştir:

```markdown
## API conventions

- Every response is wrapped by `utils/http/ResponseEnvelopeInterceptor` as `{ data, status, statusCode, message }`; errors go through `utils/http/AllExceptionsFilter` as `{ data: null, status: false, statusCode, message, errors?: { field, message }[] }` (dot paths for nested DTOs). 204 is not wrapped. Keep throwing the boilerplate shape (`new UnprocessableEntityException({ status, errors: { field: 'key' } })`) — the filter flattens it.
- Records that belong to a user are looked up scoped to that user and wrapped in `orNotFound(...)` (`utils/or-not-found.ts`): someone else's record is a 404, never a 403.
- Phone login: the client sends a phone-auth `idToken` to `POST /api/v1/auth/phone/login`; `auth-phone/verifier/PhoneTokenVerifier` turns it into an E.164 number. Only `DevPhoneTokenVerifier` exists (accepts `dev:+905551112233`); production refuses to boot until a Firebase verifier is returned from `phone-token-verifier.provider.ts`.
- `profileCompleted` is derived in `UserMapper.toDomain` (first name + last name + KVKK consent) — never store it.
- Phase specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
```

- [ ] **Step 4: Son doğrulama ve commit**

Run: `npm run lint && npm run build && npm test && npm run test:e2e -- --runInBand`
Expected: hepsi PASS.

```bash
git add test/user/phone-auth.e2e-spec.ts CLAUDE.md
git commit -m "test(e2e): phone login to account deletion; document API conventions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push
```
