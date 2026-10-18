import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../orders/dto/list-orders.dto';
import { ReviewFilter } from '../../trust/trust.enums';

/** GET /kitchens/me/reviews */
export class ListCookReviewsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReviewFilter, default: ReviewFilter.all })
  @IsOptional()
  @IsEnum(ReviewFilter)
  filter: ReviewFilter = ReviewFilter.all;
}
