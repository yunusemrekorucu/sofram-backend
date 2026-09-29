import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { SessionService } from '../../session/session.service';
import { JwtStrategy } from './jwt.strategy';

const payload = { id: 7, role: { id: 2 }, sessionId: 99, iat: 0, exp: 0 };

const buildStrategy = () => {
  const sessions = { findById: jest.fn() };
  const config = { getOrThrow: () => 'secret' };
  const strategy = new JwtStrategy(
    config as unknown as ConfigService<AllConfigType>,
    sessions as unknown as SessionService,
  );

  return { strategy, sessions };
};

describe('JwtStrategy.validate', () => {
  it('should accept a token whose session is still alive', async () => {
    const { strategy, sessions } = buildStrategy();
    sessions.findById.mockResolvedValue({ id: 99, user: { id: 7 } });

    await expect(strategy.validate(payload)).resolves.toBe(payload);
    expect(sessions.findById).toHaveBeenCalledWith(99);
  });

  it('should reject a token whose session was logged out or deleted', async () => {
    const { strategy, sessions } = buildStrategy();
    sessions.findById.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toThrow('Unauthorized');
  });

  it('should reject a token whose session belongs to another user', async () => {
    const { strategy, sessions } = buildStrategy();
    sessions.findById.mockResolvedValue({ id: 99, user: { id: 8 } });

    await expect(strategy.validate(payload)).rejects.toThrow('Unauthorized');
  });

  it('should reject a token without a session id', async () => {
    const { strategy, sessions } = buildStrategy();

    await expect(
      strategy.validate({ ...payload, sessionId: undefined as never }),
    ).rejects.toThrow('Unauthorized');
    expect(sessions.findById).not.toHaveBeenCalled();
  });
});
