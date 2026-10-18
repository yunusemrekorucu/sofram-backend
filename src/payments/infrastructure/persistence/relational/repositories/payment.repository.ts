import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Payment } from '../../../../domain/payment';
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
    payload: Partial<Pick<Payment, 'status' | 'refundedAt'>>,
  ): Promise<void> {
    await this.paymentRepository.update({ id }, payload);
  }
}
