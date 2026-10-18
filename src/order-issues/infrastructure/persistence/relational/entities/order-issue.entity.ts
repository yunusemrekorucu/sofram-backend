import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import {
  IssueCategory,
  IssueResolution,
  IssueStatus,
} from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'order_issue',
})
@Index(['orderId', 'createdAt'])
// One open report per order; resolved and rejected ones pile up beside it.
@Index('IDX_order_issue_open_order', ['orderId'], {
  unique: true,
  where: `"status" = 'open'`,
})
export class OrderIssueEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'reporterId' })
  reporter?: UserEntity;

  @Column({ type: Number })
  reporterId: number;

  @Column({ type: String })
  category: IssueCategory;

  @Column({ type: 'varchar', length: 1000 })
  description: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: FileSnapshot[];

  @Column({ type: String })
  requestedResolution: IssueResolution;

  @Column({ type: String })
  status: IssueStatus;

  @Column({ type: Number, nullable: true })
  refundKurus: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  adminNote: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
