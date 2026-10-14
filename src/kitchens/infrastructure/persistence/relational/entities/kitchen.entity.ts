import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryTier } from '../../../../../catalog/delivery';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { KitchenHour } from '../../../../../catalog/opening-state';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'kitchen',
})
@Index(['latitude', 'longitude'])
export class KitchenEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One kitchen per user: the one-to-one join column is unique.
  @OneToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'ownerId' })
  owner?: UserEntity;

  @Column({ type: Number })
  ownerId: number;

  @Column({ type: String })
  name: string;

  @Column({ type: String, nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', nullable: true })
  coverPhoto: FileSnapshot | null;

  @Column({ type: String })
  fullAddress: string;

  @Column({ type: String })
  district: string;

  @Column({ type: String })
  neighborhood: string;

  // Exact coordinates; the API only hands out rounded ones to customers.
  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: Boolean })
  pickupEnabled: boolean;

  @Column({ type: Boolean })
  deliveryEnabled: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  deliveryTiers: DeliveryTier[];

  // Derived (deliveryRadiusOf) for the discovery query.
  @Column({ type: 'double precision', nullable: true })
  deliveryRadiusKm: number | null;

  @Column({ type: Number, nullable: true })
  freeDeliveryMinKurus: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  hours: KitchenHour[];

  @Column({ type: Boolean, default: false })
  isPaused: boolean;

  @Column({ type: Boolean, default: false })
  isVerified: boolean;

  // Derived (foldTurkish) for search.
  @Column({ type: String })
  searchText: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
