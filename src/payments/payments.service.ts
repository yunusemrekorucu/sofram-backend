import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NewPayment, Payment, PaymentStatus } from './domain/payment';
import { PaymentRepository } from './infrastructure/persistence/payment.repository';
import { PaymentProvider } from './provider/payment-provider';

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  /**
   * Charges an order being placed and returns the payment row for the
   * caller's transaction to store. A decline is a 402 `paymentFailed`; the
   * caller's transaction rolls back, so nothing is stored.
   */
  async charge(orderId: string, amountKurus: number): Promise<NewPayment> {
    try {
      const { providerRef } = await this.paymentProvider.charge({
        orderId,
        amountKurus,
      });

      return {
        orderId,
        provider: this.paymentProvider.name,
        providerRef,
        amountKurus,
        status: PaymentStatus.paid,
        paidAt: new Date(),
        refundedAt: null,
      };
    } catch (error) {
      this.logger.warn(
        `Charge declined for order ${orderId}: ${reasonOf(error)}`,
      );

      throw new HttpException(
        { status: HttpStatus.PAYMENT_REQUIRED, error: 'paymentFailed' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Gives a closed order's money back. Never throws: a refused refund is
   * stored as `refund_failed` and logged — the order closes either way.
   */
  async refund(orderId: string): Promise<PaymentStatus | null> {
    const payment = await this.paymentRepository.findByOrderId(orderId);

    if (!payment || payment.status !== PaymentStatus.paid) {
      return payment?.status ?? null;
    }

    try {
      await this.paymentProvider.refund({
        providerRef: payment.providerRef,
        amountKurus: payment.amountKurus,
      });
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.refunded,
        refundedAt: new Date(),
      });
      return PaymentStatus.refunded;
    } catch (error) {
      this.logger.error(
        `Refund failed for order ${orderId}: ${reasonOf(error)}`,
      );
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.refundFailed,
      });
      return PaymentStatus.refundFailed;
    }
  }

  findByOrderId(orderId: string): Promise<Payment | null> {
    return this.paymentRepository.findByOrderId(orderId);
  }
}
