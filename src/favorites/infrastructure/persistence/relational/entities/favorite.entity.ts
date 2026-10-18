import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

/** A customer following a kitchen (kitchens only, never products). */
@Entity({
  name: 'favorite',
})
@Unique(['userId', 'kitchenId'])
export class FavoriteEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'userId' })
  user?: UserEntity;

  @Column({ type: Number })
  userId: number;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Column({ type: 'uuid' })
  kitchenId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
