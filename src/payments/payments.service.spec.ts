import {
  HttpException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
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
    refundedKurus: 0,
    status: PaymentStatus.paid,
    paidAt: new Date(),
    refundedAt: null,
    ...overrides,
  });

const build = (provider: PaymentProvider = new DevPaymentProvider(false)) => {
  const repository = {
    findByOrderId: jest.fn().mockResolvedValue(paid()),
    update: jest.fn().mockResolvedValue(undefined),
    refundPartial: jest
      .fn()
      .mockImplementation(
        async (
          _orderId,
          amountKurus,
          refund: (p: Payment) => Promise<void>,
        ) => {
          const payment = paid();
          await refund(payment);
          return { ...payment, refundedKurus: amountKurus };
        },
      ),
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
        refundedKurus: 29400,
      });
    });

    it('should refund only what a partial refund left', async () => {
      const provider = new DevPaymentProvider(false);
      const refund = jest.spyOn(provider, 'refund');
      const { service, repository } = build(provider);
      repository.findByOrderId.mockResolvedValue(paid({ refundedKurus: 9400 }));

      await service.refund('o1');

      expect(refund).toHaveBeenCalledWith({
        providerRef: 'dev_ref',
        amountKurus: 20000,
      });
      expect(repository.update).toHaveBeenCalledWith(
        'pay1',
        expect.objectContaining({ refundedKurus: 29400 }),
      );
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

describe('PaymentsService.refundPartial', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('should send the partial amount to the provider and return the payment', async () => {
    const provider = new DevPaymentProvider(false);
    const refund = jest.spyOn(provider, 'refund');
    const { service, repository } = build(provider);

    await expect(service.refundPartial('o1', 5000)).resolves.toMatchObject({
      refundedKurus: 5000,
    });
    expect(repository.refundPartial).toHaveBeenCalledWith(
      'o1',
      5000,
      expect.any(Function),
    );
    expect(refund).toHaveBeenCalledWith({
      providerRef: 'dev_ref',
      amountKurus: 5000,
    });
  });

  it('should 422 refundKurus beyond what was paid', async () => {
    const { service, repository } = build();
    repository.refundPartial.mockResolvedValue(null);

    const error = await service.refundPartial('o1', 99999).catch((e) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      status: 422,
      errors: { refundKurus: 'exceedsPaid' },
    });
  });

  it('should turn a refused refund into 502 refundFailed', async () => {
    const provider = new DevPaymentProvider(false);
    jest.spyOn(provider, 'refund').mockRejectedValue(new Error('down'));
    const { service } = build(provider);

    const error = await service.refundPartial('o1', 5000).catch((e) => e);

    expect((error as HttpException).getStatus()).toBe(502);
    expect((error as HttpException).getResponse()).toEqual({
      status: 502,
      error: 'refundFailed',
    });
  });
});
