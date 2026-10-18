import { HttpException, Logger } from '@nestjs/common';
import { Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentsService } from './payments.service';
import { DevPaymentProvider } from './provider/dev-payment-provider';
import { PaymentProvider } from './provider/payment-provider';

const paid = (overrides: Partial<Payment> = {}): Payment =>
  Object.assign(new Payment(), {
    id: 'pay1',
    orderId: 'o1',
    provider: 'dev',
    providerRef: 'dev_ref',
    amountKurus: 29400,
    status: PaymentStatus.paid,
    paidAt: new Date(),
    refundedAt: null,
    ...overrides,
  });

const build = (provider: PaymentProvider = new DevPaymentProvider(false)) => {
  const repository = {
    findByOrderId: jest.fn().mockResolvedValue(paid()),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PaymentsService(
    repository as unknown as PaymentRepository,
    provider,
  );
  return { service, repository };
};

describe('PaymentsService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('charge', () => {
    it('should return a paid payment for the order total', async () => {
      const { service } = build();

      await expect(service.charge('o1', 29400)).resolves.toMatchObject({
        orderId: 'o1',
        provider: 'dev',
        providerRef: expect.stringMatching(/^dev_/),
        amountKurus: 29400,
        status: PaymentStatus.paid,
        refundedAt: null,
      });
    });

    it('should turn a decline into 402 paymentFailed', async () => {
      const { service } = build(new DevPaymentProvider(true));

      const error = await service.charge('o1', 29400).catch((e) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(402);
      expect((error as HttpException).getResponse()).toEqual({
        status: 402,
        error: 'paymentFailed',
      });
    });
  });

  describe('refund', () => {
    it('should refund a paid order', async () => {
      const { service, repository } = build();

      await expect(service.refund('o1')).resolves.toBe(PaymentStatus.refunded);
      expect(repository.update).toHaveBeenCalledWith('pay1', {
        status: PaymentStatus.refunded,
        refundedAt: expect.any(Date),
      });
    });

    it('should record refund_failed instead of throwing', async () => {
      const provider = new DevPaymentProvider(false);
      jest.spyOn(provider, 'refund').mockRejectedValue(new Error('down'));
      const { service, repository } = build(provider);

      await expect(service.refund('o1')).resolves.toBe(
        PaymentStatus.refundFailed,
      );
      expect(repository.update).toHaveBeenCalledWith('pay1', {
        status: PaymentStatus.refundFailed,
      });
    });

    it('should leave missing and already refunded payments alone', async () => {
      const { service, repository } = build();

      repository.findByOrderId.mockResolvedValueOnce(null);
      await expect(service.refund('o1')).resolves.toBeNull();

      repository.findByOrderId.mockResolvedValueOnce(
        paid({ status: PaymentStatus.refunded }),
      );
      await expect(service.refund('o1')).resolves.toBe(PaymentStatus.refunded);

      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
