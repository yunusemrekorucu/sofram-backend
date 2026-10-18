import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { DeliveryTier } from '../../catalog/delivery';
import { KitchenHour } from '../../catalog/opening-state';
import { FileType } from '../../files/domain/file';
import { User } from '../../users/domain/user';
import { DeliveryTierDto, KitchenHourDto } from '../dto/create-kitchen.dto';

/** The cook's own view of the kitchen (GET/PATCH /kitchens/me). */
export class Kitchen {
  @ApiProperty({ type: String })
  id: string;

  @Exclude({ toPlainOnly: true })
  ownerId: User['id'];

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: () => FileType, nullable: true })
  coverPhoto: FileType | null;

  @ApiProperty({ type: String })
  fullAddress: string;

  @ApiProperty({ type: String })
  district: string;

  @ApiProperty({ type: String })
  neighborhood: string;

  @ApiProperty({ type: Number })
  latitude: number;

  @ApiProperty({ type: Number })
  longitude: number;

  @ApiProperty({ type: Boolean })
  pickupEnabled: boolean;

  @ApiProperty({ type: Boolean })
  deliveryEnabled: boolean;

  @ApiProperty({ type: () => DeliveryTierDto, isArray: true })
  deliveryTiers: DeliveryTier[];

  @Exclude({ toPlainOnly: true })
  deliveryRadiusKm: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  freeDeliveryMinKurus: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'kuruş' })
  minOrderKurus: number | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  hours: KitchenHour[];

  @ApiProperty({ type: Boolean })
  isPaused: boolean;

  @ApiProperty({ type: Boolean })
  isVerified: boolean;

  @Exclude({ toPlainOnly: true })
  searchText: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
