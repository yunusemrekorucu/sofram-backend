import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ReviewReportReason } from '../../../../../trust/trust.enums';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { ReviewEntity } from './review.entity';

/** A cook flagging a review of their kitchen; once per review and cook. */
@Entity({
  name: 'review_report',
})
@Unique(['reviewId', 'reporterId'])
export class ReviewReportEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ReviewEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'reviewId' })
  review?: ReviewEntity;

  @Column({ type: 'uuid' })
  reviewId: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'reporterId' })
  reporter?: UserEntity;

  @Column({ type: Number })
  reporterId: number;

  @Column({ type: String })
  reason: ReviewReportReason;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
