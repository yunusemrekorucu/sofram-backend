import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { ListCookReviewsQueryDto } from './dto/list-reviews.dto';
import { ReplyReviewDto, ReportReviewDto } from './dto/review-actions.dto';
import { ReviewsService } from './reviews.service';
import { KitchenReviewView } from './views';

/** Reviews of the signed-in cook's kitchen; no kitchen → 404. */
@ApiTags('Kitchen reviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/reviews',
  version: '1',
})
export class CookReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(KitchenReviewView) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListCookReviewsQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenReviewView>> {
    return this.reviewsService.listMine(request.user.id, query);
  }

  @Put(':id/reply')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenReviewView })
  reply(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyReviewDto,
  ): Promise<KitchenReviewView> {
    return this.reviewsService.reply(request.user.id, id, dto.reply);
  }

  @Delete(':id/reply')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  removeReply(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.reviewsService.removeReply(request.user.id, id);
  }

  @Post(':id/report')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  report(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportReviewDto,
  ): Promise<void> {
    return this.reviewsService.report(request.user.id, id, dto);
  }
}
