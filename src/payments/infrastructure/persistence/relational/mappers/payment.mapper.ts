import { NewPayment, Payment } from '../../../../domain/payment';
import { PaymentEntity } from '../entities/payment.entity';

export class PaymentMapper {
  static toDomain(raw: PaymentEntity): Payment {
    return Object.assign(new Payment(), {
      id: raw.id,
      orderId: raw.orderId,
      provider: raw.provider,
      providerRef: raw.providerRef,
      amountKurus: raw.amountKurus,
      refundedKurus: raw.refundedKurus,
      status: raw.status,
      paidAt: raw.paidAt,
      refundedAt: raw.refundedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static toPersistence(domain: Partial<NewPayment>): PaymentEntity {
    return Object.assign(new PaymentEntity(), domain);
  }
}
