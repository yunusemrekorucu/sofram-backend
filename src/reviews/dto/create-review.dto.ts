import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReviewTag } from '../../trust/trust.enums';

const STARS = { minimum: 1, maximum: 5 };

export class CreateReviewDto {
  @ApiProperty({ ...STARS, description: 'Genel puan, zorunlu' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  taste?: number | null;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  portion?: number | null;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  packaging?: number | null;

  @ApiPropertyOptional({ ...STARS, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  timing?: number | null;

  @ApiPropertyOptional({ enum: ReviewTag, isArray: true, maxItems: 3 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(ReviewTag, { each: true })
  tags?: ReviewTag[];

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 3,
    description: 'Yüklenmiş dosya id’leri',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds?: string[];
}
