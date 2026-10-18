import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { DeliveryAddress } from '../../../../domain/order';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from '../../../../order.enums';
import { OrderItemEntity } from './order-item.entity';

@Entity({
  name: 'order',
})
@Index(['kitchenId', 'status'])
@Index(['customerId', 'status'])
export class OrderEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 6, unique: true })
  code: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'customerId' })
  customer?: UserEntity;

  @Column({ type: Number })
  customerId: number;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Column({ type: 'uuid' })
  kitchenId: string;

  @Column({ type: String })
  status: OrderStatus;

  @Column({ type: String })
  fulfillment: Fulfillment;

  @Column({ type: 'jsonb', nullable: true })
  deliveryAddress: DeliveryAddress | null;

  @Column({ type: 'double precision', nullable: true })
  distanceKm: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: Number })
  subtotalKurus: number;

  @Column({ type: Number })
  deliveryFeeKurus: number;

  @Column({ type: Number })
  serviceFeeKurus: number;

  @Column({ type: Number })
  totalKurus: number;

  @Column({ type: 'char', length: 4, nullable: true })
  pickupCode: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  estimatedReadyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  preparingAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  onTheWayAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: String, nullable: true })
  cancelledBy: CancelledBy | null;

  @Column({ type: String, nullable: true })
  reason: OrderReason | null;

  @OneToMany(() => OrderItemEntity, (item) => item.order)
  items?: OrderItemEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
