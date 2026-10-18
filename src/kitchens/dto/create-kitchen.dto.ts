import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_DELIVERY_RADIUS_KM } from '../../catalog/delivery';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DeliveryTierDto {
  @ApiProperty({ example: 3 })
  @IsNumber()
  @Min(0.1)
  @Max(MAX_DELIVERY_RADIUS_KM)
  upToKm: number;

  @ApiProperty({ example: 2500, description: 'kuruş' })
  @IsInt()
  @Min(0)
  @Max(100_000)
  feeKurus: number;
}

export class KitchenHourDto {
  @ApiProperty({ example: 1, description: '1 = Pazartesi … 7 = Pazar' })
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @ApiProperty({ example: '11:00' })
  @Matches(HH_MM, { message: 'invalidTime' })
  opensAt: string;

  @ApiProperty({ example: '20:00' })
  @Matches(HH_MM, { message: 'invalidTime' })
  closesAt: string;
}

export class CreateKitchenDto {
  @ApiProperty({ example: 'Ayşe Teyze Mutfağı' })
  @IsString()
  @Length(2, 60)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  coverPhotoId?: string | null;

  @ApiProperty({
    format: 'uuid',
    description: 'Kullanıcının adreslerinden biri; kopyalanır',
  })
  @IsUUID()
  addressId: string;

  @ApiProperty()
  @IsBoolean()
  pickupEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  deliveryEnabled: boolean;

  @ApiProperty({ type: () => DeliveryTierDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => DeliveryTierDto)
  deliveryTiers: DeliveryTierDto[];

  @ApiPropertyOptional({ nullable: true, description: 'kuruş' })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeDeliveryMinKurus?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'kuruş, 0–100000; ara toplam altındaysa sipariş verilemez',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  minOrderKurus?: number | null;

  @ApiProperty({ type: () => KitchenHourDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => KitchenHourDto)
  hours: KitchenHourDto[];
}
