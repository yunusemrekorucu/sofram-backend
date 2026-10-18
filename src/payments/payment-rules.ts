import { Payment, PaymentStatus } from './domain/payment';

/**
 * A partial refund needs a payment that is still `paid` and must keep the
 * refunds within what was paid (a full refund sets refundedKurus to amountKurus).
 */
export function canRefund(
  payment: Pick<Payment, 'status' | 'amountKurus' | 'refundedKurus'>,
  amountKurus: number,
): boolean {
  return (
    payment.status === PaymentStatus.paid &&
    amountKurus > 0 &&
    payment.refundedKurus + amountKurus <= payment.amountKurus
  );
}
