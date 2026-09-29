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
