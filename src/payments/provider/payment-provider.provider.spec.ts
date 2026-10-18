import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { DevPaymentProvider } from './dev-payment-provider';
import { PaymentDeclinedError } from './payment-provider';
import { createPaymentProvider } from './payment-provider.provider';

const configWith = (values: {
  nodeEnv: string;
  provider?: string;
  devPaymentFail?: boolean;
}) => {
  const byKey: Record<string, unknown> = {
    'app.nodeEnv': values.nodeEnv,
    'payments.provider': values.provider ?? 'dev',
    'payments.devPaymentFail': values.devPaymentFail ?? false,
  };

  return {
    get: (key: string) => byKey[key],
    getOrThrow: (key: string) => byKey[key],
  } as unknown as ConfigService<AllConfigType>;
};

const charge = (nodeEnv: string, devPaymentFail: boolean) =>
  createPaymentProvider(configWith({ nodeEnv, devPaymentFail })).charge({
    orderId: 'o1',
    amountKurus: 100,
  });

describe('createPaymentProvider', () => {
  it('should bind the dev provider', () => {
    expect(
      createPaymentProvider(configWith({ nodeEnv: 'development' })),
    ).toBeInstanceOf(DevPaymentProvider);
  });

  it('should decline while DEV_PAYMENT_FAIL is on outside production', async () => {
    await expect(charge('development', true)).rejects.toBeInstanceOf(
      PaymentDeclinedError,
    );
  });

  it('should ignore DEV_PAYMENT_FAIL in production', async () => {
    await expect(charge('production', true)).resolves.toHaveProperty(
      'providerRef',
    );
  });

  it('should refuse an unknown provider', () => {
    expect(() =>
      createPaymentProvider(
        configWith({ nodeEnv: 'development', provider: 'stripe' }),
      ),
    ).toThrow(/PAYMENT_PROVIDER/);
  });
});
