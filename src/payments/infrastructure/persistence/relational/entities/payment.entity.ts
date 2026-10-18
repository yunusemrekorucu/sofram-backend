import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { PaymentStatus } from '../../../../domain/payment';

@Entity({
  name: 'payment',
})
export class PaymentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One payment per order: the one-to-one join column is unique.
  @OneToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: String })
  provider: string;

  @Column({ type: String })
  providerRef: string;

  @Column({ type: Number })
  amountKurus: number;

  @Column({ type: String })
  status: PaymentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  refundedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
