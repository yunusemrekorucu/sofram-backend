import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { Allergen, DietTag, SaleType } from '../../catalog/catalog.enums';
import { Category } from '../../categories/domain/category';
import { FileType } from '../../files/domain/file';

export class Product {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  kitchenId: string;

  @ApiProperty({ type: () => Category })
  category: Category;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: Number, description: 'kuruş' })
  priceKurus: number;

  @ApiProperty({ enum: SaleType })
  saleType: SaleType;

  @ApiProperty({ type: Number, nullable: true })
  prepMinutes: number | null;

  @ApiProperty({ type: Number, nullable: true })
  portionsAvailable: number | null;

  @ApiProperty({ enum: Allergen, isArray: true })
  allergens: Allergen[];

  @ApiProperty({ enum: DietTag, isArray: true })
  dietTags: DietTag[];

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];

  @ApiProperty({ type: Boolean })
  isActive: boolean;

  @Exclude({ toPlainOnly: true })
  searchText: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
