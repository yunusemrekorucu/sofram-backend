import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReviewReportReason } from '../../trust/trust.enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** PUT /kitchens/me/reviews/:id/reply — writes or replaces the answer. */
export class ReplyReviewDto {
  @ApiProperty({ maxLength: 300 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reply: string;
}

/** POST /kitchens/me/reviews/:id/report */
export class ReportReviewDto {
  @ApiProperty({ enum: ReviewReportReason })
  @IsEnum(ReviewReportReason)
  reason: ReviewReportReason;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

/** PATCH /admin/reviews/:id */
export class HideReviewDto {
  @ApiProperty()
  @IsBoolean()
  isHidden: boolean;
}
