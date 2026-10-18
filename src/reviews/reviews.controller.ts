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
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { PageQueryDto } from '../orders/dto/list-orders.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewsService } from './reviews.service';
import { KitchenReviewsPage, OrderReviewView } from './views';

/** The customer's side: review an order, delete it, read a kitchen's reviews. */
@ApiTags('Reviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  version: '1',
})
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('orders/:id/review')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: OrderReviewView })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
  ): Promise<OrderReviewView> {
    return this.reviewsService.create(request.user.id, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.reviewsService.remove(request.user.id, id);
  }

  @Get('discover/kitchens/:id/reviews')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenReviewsPage })
  kitchenReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<KitchenReviewsPage> {
    return this.reviewsService.kitchenReviews(id, query);
  }
}
