import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { ReviewTag } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'review',
})
@Index(['kitchenId', 'createdAt'])
export class ReviewEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One review per order, deleted ones included: the join column is unique.
  @OneToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Column({ type: 'uuid' })
  kitchenId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'authorId' })
  author?: UserEntity;

  @Index()
  @Column({ type: Number })
  authorId: number;

  @Column({ type: 'smallint' })
  rating: number;

  @Column({ type: 'smallint', nullable: true })
  taste: number | null;

  @Column({ type: 'smallint', nullable: true })
  portion: number | null;

  @Column({ type: 'smallint', nullable: true })
  packaging: number | null;

  @Column({ type: 'smallint', nullable: true })
  timing: number | null;

  @Column({ type: 'simple-array', default: '' })
  tags: ReviewTag[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  comment: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: FileSnapshot[];

  @Column({ type: 'varchar', length: 300, nullable: true })
  reply: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  repliedAt: Date | null;

  @Column({ type: Boolean, default: false })
  isHidden: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt: Date | null;
}
