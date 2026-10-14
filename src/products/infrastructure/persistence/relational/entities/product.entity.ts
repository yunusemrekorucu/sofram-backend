import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  Allergen,
  DietTag,
  SaleType,
} from '../../../../../catalog/catalog.enums';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { CategoryEntity } from '../../../../../categories/infrastructure/persistence/relational/entities/category.entity';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'product',
})
export class ProductEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => KitchenEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'kitchenId' })
  kitchen?: KitchenEntity;

  @Index()
  @Column({ type: 'uuid' })
  kitchenId: string;

  @ManyToOne(() => CategoryEntity, { eager: true, nullable: false })
  @JoinColumn({ name: 'categoryId' })
  category: CategoryEntity;

  @Column({ type: 'uuid' })
  categoryId: string;

  @Column({ type: String })
  name: string;

  @Column({ type: String, nullable: true })
  description: string | null;

  @Column({ type: Number })
  priceKurus: number;

  @Column({ type: String })
  saleType: SaleType;

  @Column({ type: Number, nullable: true })
  prepMinutes: number | null;

  @Column({ type: Number, nullable: true })
  portionsAvailable: number | null;

  @Column({ type: 'simple-array', default: '' })
  allergens: Allergen[];

  @Column({ type: 'simple-array', default: '' })
  dietTags: DietTag[];

  // Ordered gallery; the first one is the card photo.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  photos: FileSnapshot[];

  @Column({ type: Boolean, default: true })
  isActive: boolean;

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
