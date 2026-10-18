import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPaymentProvider } from './dev-payment-provider';
import { PaymentProvider } from './payment-provider';

/**
 * PAYMENT_PROVIDER picks the implementation; `dev` is the only one so far.
 * DEV_PAYMENT_FAIL is a local test switch and is ignored in production.
 */
export const createPaymentProvider = (
  config: ConfigService<AllConfigType>,
): PaymentProvider => {
  const provider = config.getOrThrow('payments.provider', { infer: true });
  const isProduction =
    config.get('app.nodeEnv', { infer: true }) === 'production';

  if (provider === 'dev') {
    return new DevPaymentProvider(
      !isProduction &&
        config.get('payments.devPaymentFail', { infer: true }) === true,
    );
  }

  throw new Error(`PaymentProvider: unknown PAYMENT_PROVIDER "${provider}"`);
};

export const paymentProviderProvider: Provider = {
  provide: PaymentProvider,
  inject: [ConfigService],
  useFactory: createPaymentProvider,
};
