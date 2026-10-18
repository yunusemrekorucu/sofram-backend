import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Payment, PaymentStatus } from '../../../../domain/payment';
import { canRefund } from '../../../../payment-rules';
import { PaymentRepository } from '../../payment.repository';
import { PaymentEntity } from '../entities/payment.entity';
import { PaymentMapper } from '../mappers/payment.mapper';

@Injectable()
export class PaymentRelationalRepository implements PaymentRepository {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
  ) {}

  async findByOrderId(orderId: string): Promise<NullableType<Payment>> {
    const entity = await this.paymentRepository.findOne({ where: { orderId } });
    return entity ? PaymentMapper.toDomain(entity) : null;
  }

  async update(
    id: Payment['id'],
    payload: Partial<Pick<Payment, 'status' | 'refundedAt' | 'refundedKurus'>>,
  ): Promise<void> {
    await this.paymentRepository.update({ id }, payload);
  }

  refundPartial(
    orderId: string,
    amountKurus: number,
    refund: (payment: Payment) => Promise<void>,
  ): Promise<NullableType<Payment>> {
    return this.paymentRepository.manager.transaction(async (manager) => {
      const entity = await manager.findOne(PaymentEntity, {
        where: { orderId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!entity || !canRefund(entity, amountKurus)) {
        return null;
      }

      await refund(PaymentMapper.toDomain(entity));

      const refundedKurus = entity.refundedKurus + amountKurus;
      const changes: Partial<PaymentEntity> =
        refundedKurus === entity.amountKurus
          ? {
              refundedKurus,
              status: PaymentStatus.refunded,
              refundedAt: new Date(),
            }
          : { refundedKurus };
      await manager.update(PaymentEntity, { id: entity.id }, changes);

      return PaymentMapper.toDomain(Object.assign(entity, changes));
    });
  }
}
