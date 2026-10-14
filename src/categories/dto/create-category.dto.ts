import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'soup' })
  @Matches(/^[a-z0-9-]+$/, { message: 'invalidSlug' })
  @Length(2, 40)
  slug: string;

  @ApiProperty({ example: 'Çorba' })
  @IsString()
  @Length(1, 40)
  nameTr: string;

  @ApiProperty({ example: 'Soup' })
  @IsString()
  @Length(1, 40)
  nameEn: string;

  @ApiPropertyOptional({ example: 'soup', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
