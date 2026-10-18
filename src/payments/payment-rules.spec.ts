import { PaymentStatus } from './domain/payment';
import { canRefund } from './payment-rules';

const paid = {
  status: PaymentStatus.paid,
  amountKurus: 14700,
  refundedKurus: 0,
};

describe('canRefund', () => {
  it('should allow refunds up to what was paid, in steps', () => {
    expect(canRefund(paid, 14700)).toBe(true);
    expect(canRefund({ ...paid, refundedKurus: 5000 }, 9700)).toBe(true);
  });

  it('should refuse going past what was paid', () => {
    expect(canRefund(paid, 14701)).toBe(false);
    expect(canRefund({ ...paid, refundedKurus: 5000 }, 9701)).toBe(false);
  });

  it('should refuse a non-positive amount', () => {
    expect(canRefund(paid, 0)).toBe(false);
    expect(canRefund(paid, -100)).toBe(false);
  });

  it('should refuse a payment that is no longer paid', () => {
    for (const status of [
      PaymentStatus.refunded,
      PaymentStatus.refundFailed,
      PaymentStatus.failed,
    ]) {
      expect(canRefund({ ...paid, status }, 100)).toBe(false);
    }
  });
});
