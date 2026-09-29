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
    expect(
      createPhoneTokenVerifier(configWithEnv('development')),
    ).toBeInstanceOf(DevPhoneTokenVerifier);
  });

  it('should refuse to boot production without a real verifier', () => {
    expect(() => createPhoneTokenVerifier(configWithEnv('production'))).toThrow(
      /no production verifier/,
    );
  });
});
