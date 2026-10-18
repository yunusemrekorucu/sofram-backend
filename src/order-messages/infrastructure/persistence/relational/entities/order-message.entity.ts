import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { MessageSide } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'order_message',
})
@Index(['orderId', 'createdAt'])
export class OrderMessageEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'senderId' })
  sender?: UserEntity;

  @Index()
  @Column({ type: Number })
  senderId: number;

  @Column({ type: String })
  senderRole: MessageSide;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  // Millisecond precision: the client polls with `after` = the last
  // createdAt it saw (JSON keeps milliseconds), so stored values must match.
  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt: Date;
}
