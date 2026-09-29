import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPhoneTokenVerifier } from './dev-phone-token-verifier';
import { createPhoneTokenVerifier } from './phone-token-verifier.provider';

const configWith = (values: {
  nodeEnv: string;
  phoneDevVerifier?: boolean;
}) => {
  const byKey: Record<string, unknown> = {
    'app.nodeEnv': values.nodeEnv,
    'auth.phoneDevVerifier': values.phoneDevVerifier,
  };

  return {
    get: (key: string) => byKey[key],
    getOrThrow: (key: string) => byKey[key],
  } as unknown as ConfigService<AllConfigType>;
};

describe('createPhoneTokenVerifier', () => {
  it('should bind the dev verifier when AUTH_PHONE_DEV_VERIFIER is on', () => {
    expect(
      createPhoneTokenVerifier(
        configWith({ nodeEnv: 'development', phoneDevVerifier: true }),
      ),
    ).toBeInstanceOf(DevPhoneTokenVerifier);
  });

  it.each(['development', 'staging', 'test', 'production'])(
    'should refuse to boot without the opt-in flag (NODE_ENV=%s)',
    (nodeEnv) => {
      expect(() =>
        createPhoneTokenVerifier(
          configWith({ nodeEnv, phoneDevVerifier: false }),
        ),
      ).toThrow(/no production verifier/);
      expect(() => createPhoneTokenVerifier(configWith({ nodeEnv }))).toThrow(
        /no production verifier/,
      );
    },
  );

  it('should refuse the dev verifier in production even when the flag is on', () => {
    expect(() =>
      createPhoneTokenVerifier(
        configWith({ nodeEnv: 'production', phoneDevVerifier: true }),
      ),
    ).toThrow(/AUTH_PHONE_DEV_VERIFIER/);
  });
});
