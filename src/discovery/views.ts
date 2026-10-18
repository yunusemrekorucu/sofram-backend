import { ApiProperty } from '@nestjs/swagger';
import { Allergen, DietTag, SaleType } from '../catalog/catalog.enums';
import { DeliveryTier } from '../catalog/delivery';
import { KitchenHour } from '../catalog/opening-state';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import {
  DeliveryTierDto,
  KitchenHourDto,
} from '../kitchens/dto/create-kitchen.dto';

/** What customers see of a kitchen; never the exact address. */
export class KitchenSummary {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: Number, description: '0.1 km hassasiyet' })
  distanceKm: number;

  @ApiProperty({ type: Boolean })
  isOpenNow: boolean;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Kapalıysa bir sonraki açılış',
  })
  opensAt: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tek ondalık; ratingCount 0 iken null ("Yeni")',
  })
  ratingAvg: number | null;

  @ApiProperty({ type: Number })
  ratingCount: number;
}

export class KitchenCard extends KitchenSummary {
  @ApiProperty({ type: () => FileType, nullable: true })
  coverPhoto: FileType | null;

  @ApiProperty({ type: String })
  neighborhood: string;

  @ApiProperty({ type: Number, description: 'Yuvarlanmış' })
  latitude: number;

  @ApiProperty({ type: Number, description: 'Yuvarlanmış' })
  longitude: number;

  @ApiProperty({ type: Boolean })
  isPaused: boolean;

  @ApiProperty({ type: Boolean })
  pickupAvailable: boolean;

  @ApiProperty({ type: Boolean })
  deliveryAvailable: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Bu konuma, kuruş',
  })
  deliveryFeeKurus: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  freeDeliveryMinKurus: number | null;

  @ApiProperty({ type: Boolean })
  isVerified: boolean;

  @ApiProperty({ type: Boolean, description: 'Kullanıcının favorisinde' })
  isFavorite: boolean;
}

export class ProductCard {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: () => FileType, nullable: true })
  photo: FileType | null;

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

  @ApiProperty({
    enum: Allergen,
    isArray: true,
    description: 'Ürün alerjenleri ∩ kullanıcının tercihleri',
  })
  allergenWarnings: Allergen[];

  @ApiProperty({ type: () => Category })
  category: Category;

  @ApiProperty({ type: () => KitchenSummary })
  kitchen: KitchenSummary;
}

export class MenuSection {
  @ApiProperty({ type: () => Category })
  category: Category;

  @ApiProperty({ type: () => ProductCard, isArray: true })
  products: ProductCard[];
}

export class KitchenDetail extends KitchenCard {
  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  minOrderKurus: number | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  hours: KitchenHour[];

  @ApiProperty({ type: () => DeliveryTierDto, isArray: true })
  deliveryTiers: DeliveryTier[];

  @ApiProperty({ type: () => MenuSection, isArray: true })
  sections: MenuSection[];
}

export class ProductDetail extends ProductCard {
  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: () => FileType, isArray: true })
  photos: FileType[];

  // Narrows ProductCard.kitchen (a KitchenSummary) to the full card.
  @ApiProperty({ type: () => KitchenCard })
  kitchen: KitchenCard;
}
