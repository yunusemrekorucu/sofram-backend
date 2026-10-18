import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PageQueryDto } from '../orders/dto/list-orders.dto';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import { HideReviewDto } from './dto/review-actions.dto';
import { ReviewsService } from './reviews.service';
import { KitchenReviewView, ReviewReportView } from './views';

/** Swagger-only moderation (no admin panel): reported reviews, hide/show. */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({
  path: 'admin',
  version: '1',
})
export class AdminReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('review-reports')
  @ApiOkResponse({ type: InfinityPaginationResponse(ReviewReportView) })
  reports(
    @Query() query: PageQueryDto,
  ): Promise<InfinityPaginationResponseDto<ReviewReportView>> {
    return this.reviewsService.listReports(query);
  }

  @Patch('reviews/:id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenReviewView })
  setHidden(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideReviewDto,
  ): Promise<KitchenReviewView> {
    return this.reviewsService.setHidden(id, dto.isHidden);
  }
}
