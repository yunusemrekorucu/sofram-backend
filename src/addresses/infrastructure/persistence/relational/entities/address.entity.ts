import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';

import {
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
  ManyToOne,
  Index,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'address',
})
export class AddressEntity extends EntityRelationalHelper {
  @Index()
  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  user?: UserEntity;

  @Column({ type: Boolean, default: false })
  isDefault?: boolean;

  // `Number` maps to integer in Postgres; coordinates need double precision
  // (returned as a JS number, unlike `numeric` which comes back as a string).
  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({
    nullable: true,
    type: String,
  })
  directions?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  apartmentNo?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  floor?: string | null;

  @Column({
    nullable: true,
    type: String,
  })
  buildingNo?: string | null;

  @Column({
    nullable: false,
    type: String,
  })
  neighborhood: string;

  @Column({
    nullable: false,
    type: String,
  })
  district: string;

  @Column({
    nullable: false,
    type: String,
  })
  fullAddress: string;

  @Column({
    nullable: false,
    type: String,
  })
  title: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
