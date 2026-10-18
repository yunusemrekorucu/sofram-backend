import { DevPaymentProvider } from './dev-payment-provider';
import { PaymentDeclinedError } from './payment-provider';

describe('DevPaymentProvider', () => {
  it('should charge with a dev reference', async () => {
    await expect(
      new DevPaymentProvider(false).charge({ orderId: 'o1', amountKurus: 100 }),
    ).resolves.toEqual({ providerRef: expect.stringMatching(/^dev_/) });
  });

  it('should decline every charge while failing', async () => {
    await expect(
      new DevPaymentProvider(true).charge({ orderId: 'o1', amountKurus: 100 }),
    ).rejects.toBeInstanceOf(PaymentDeclinedError);
  });

  it('should always refund', async () => {
    await expect(new DevPaymentProvider(true).refund()).resolves.toBe(
      undefined,
    );
  });
});
