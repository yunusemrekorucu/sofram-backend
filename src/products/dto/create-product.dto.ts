import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Allergen, DietTag, SaleType } from '../../catalog/catalog.enums';

export class CreateProductDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ example: 'Ev usulü mantı' })
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty({ example: 14000, description: 'kuruş' })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  priceKurus: number;

  @ApiProperty({ enum: SaleType })
  @IsEnum(SaleType)
  saleType: SaleType;

  @ApiPropertyOptional({
    nullable: true,
    description: 'on_demand için zorunlu',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  prepMinutes?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'daily_portion için zorunlu',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  portionsAvailable?: number | null;

  @ApiProperty({ enum: Allergen, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Allergen, { each: true })
  allergens: Allergen[];

  @ApiProperty({ enum: DietTag, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(DietTag, { each: true })
  dietTags: DietTag[];

  @ApiProperty({
    type: [String],
    description: 'Galeri sırası; ilki kart fotoğrafı',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds: string[];

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
