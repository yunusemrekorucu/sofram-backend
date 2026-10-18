import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SaleType } from '../../../../../catalog/catalog.enums';
import { FileSnapshot } from '../../../../../catalog/file-snapshot';
import { ProductEntity } from '../../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderEntity } from './order.entity';

@Entity({
  name: 'order_item',
})
export class OrderItemEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderEntity, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order?: OrderEntity;

  @Index()
  @Column({ type: 'uuid' })
  orderId: string;

  // Products are only soft-deleted, so the link survives menu changes.
  @ManyToOne(() => ProductEntity, { eager: false, nullable: false })
  @JoinColumn({ name: 'productId' })
  product?: ProductEntity;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: Number })
  position: number;

  @Column({ type: String })
  name: string;

  @Column({ type: Number })
  unitPriceKurus: number;

  @Column({ type: String })
  saleType: SaleType;

  @Column({ type: Number, nullable: true })
  prepMinutes: number | null;

  @Column({ type: 'jsonb', nullable: true })
  photo: FileSnapshot | null;

  @Column({ type: Number })
  quantity: number;

  @Column({ type: 'varchar', length: 140, nullable: true })
  note: string | null;
}
