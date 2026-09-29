import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPhoneTokenVerifier } from './dev-phone-token-verifier';
import { PhoneTokenVerifier } from './phone-token-verifier';

/**
 * Fail-closed: the dev verifier lets `dev:<E.164>` log in as anyone, so it is
 * bound only on an explicit AUTH_PHONE_DEV_VERIFIER=true (never inferred from
 * NODE_ENV) and never in production. Anything else refuses to boot.
 */
export const createPhoneTokenVerifier = (
  config: ConfigService<AllConfigType>,
): PhoneTokenVerifier => {
  const devVerifier = config.get('auth.phoneDevVerifier', { infer: true });
  const isProduction =
    config.get('app.nodeEnv', { infer: true }) === 'production';

  if (devVerifier && isProduction) {
    throw new Error(
      'PhoneTokenVerifier: AUTH_PHONE_DEV_VERIFIER must never be enabled in production',
    );
  }

  if (devVerifier) {
    return new DevPhoneTokenVerifier();
  }

  // Return a FirebasePhoneTokenVerifier here once firebase-admin is wired in.
  throw new Error(
    'PhoneTokenVerifier: no production verifier configured (set AUTH_PHONE_DEV_VERIFIER=true for local development only)',
  );
};

export const phoneTokenVerifierProvider: Provider = {
  provide: PhoneTokenVerifier,
  inject: [ConfigService],
  useFactory: createPhoneTokenVerifier,
};
