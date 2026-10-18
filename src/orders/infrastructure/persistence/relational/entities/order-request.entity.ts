import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderEntity } from './order.entity';

/** Idempotency-Key of POST /orders → the order it created; swept after 24 h. */
@Entity({
  name: 'order_request',
})
@Unique(['customerId', 'key'])
export class OrderRequestEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  key: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'customerId' })
  customer?: UserEntity;

  @Column({ type: Number })
  customerId: number;

  @ManyToOne(() => OrderEntity, {
    eager: false,
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
