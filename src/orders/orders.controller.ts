import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { QuoteOrderDto } from './dto/quote-order.dto';
import { OrdersService } from './orders.service';
import { quoteView } from './presenters';
import {
  CustomerOrderCard,
  CustomerOrderDetail,
  OrderQuoteView,
} from './views';

/** The signed-in customer's orders; the cook's side is /kitchens/me/orders. */
@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'orders',
  version: '1',
})
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderQuoteView })
  async quote(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: QuoteOrderDto,
  ): Promise<OrderQuoteView> {
    return quoteView(await this.ordersService.quote(request.user.id, dto));
  }

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'uuid; aynı anahtarla tekrar → ilk sipariş, 200',
  })
  @ApiCreatedResponse({ type: CustomerOrderDetail })
  async create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerOrderDetail> {
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { idempotencyKey: 'mustBeUuid' },
      });
    }

    const { order, created } = await this.ordersService.create(
      request.user.id,
      dto,
      idempotencyKey,
    );

    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return order;
  }

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(CustomerOrderCard) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CustomerOrderCard>> {
    return this.ordersService.list(request.user.id, query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CustomerOrderDetail })
  detail(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOrderDetail> {
    return this.ordersService.detail(request.user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CustomerOrderDetail })
  cancel(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOrderDetail> {
    return this.ordersService.cancel(request.user.id, id);
  }
}
