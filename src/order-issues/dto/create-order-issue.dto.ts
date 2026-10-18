import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { IssueCategory, IssueResolution } from '../../trust/trust.enums';

export class CreateOrderIssueDto {
  @ApiProperty({ enum: IssueCategory })
  @IsEnum(IssueCategory)
  category: IssueCategory;

  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 1000)
  description: string;

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

  @ApiProperty({ enum: IssueResolution })
  @IsEnum(IssueResolution)
  requestedResolution: IssueResolution;
}
