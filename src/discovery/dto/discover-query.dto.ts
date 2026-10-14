import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DietTag } from '../../catalog/catalog.enums';

/** The customer's selected address (or GPS) — distances are measured from here. */
export class PointQueryDto {
  @ApiProperty({ example: 40.9862 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 29.0254 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class DiscoverQueryDto extends PointQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: DietTag,
    description: 'vegetarian vegan ürünleri de kapsar',
  })
  @IsOptional()
  @IsEnum(DietTag)
  diet?: DietTag;

  @ApiPropertyOptional({
    default: false,
    description: 'Kullanıcının alerjen tercihleriyle çakışan ürünleri çıkar',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  allergenSafe?: boolean;

  @ApiPropertyOptional({
    description: 'Ürün adı/açıklaması, mutfak adı/semti',
  })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
