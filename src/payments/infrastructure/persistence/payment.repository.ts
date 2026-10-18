import { NullableType } from '../../../utils/types/nullable.type';
import { Payment } from '../../domain/payment';

/** Payments are created with their order (OrderRepository.place). */
export abstract class PaymentRepository {
  abstract findByOrderId(orderId: string): Promise<NullableType<Payment>>;

  abstract update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt' | 'refundedKurus'>>,
  ): Promise<void>;

  /**
   * One transaction with the payment row locked: null unless the payment is
   * `paid` and `refundedKurus + amountKurus` stays within what was paid;
   * otherwise `refund` runs (its error rolls everything back) and
   * `refundedKurus` grows — reaching the full amount makes it `refunded`.
   */
  abstract refundPartial(
    orderId: string,
    amountKurus: number,
    refund: (payment: Payment) => Promise<void>,
  ): Promise<NullableType<Payment>>;
}
