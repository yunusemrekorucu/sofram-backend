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
