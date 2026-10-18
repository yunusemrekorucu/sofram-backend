import { NullableType } from '../../../utils/types/nullable.type';
import { Payment } from '../../domain/payment';

/** Payments are created with their order (OrderRepository.place). */
export abstract class PaymentRepository {
  abstract findByOrderId(orderId: string): Promise<NullableType<Payment>>;

  abstract update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt'>>,
  ): Promise<void>;
}
