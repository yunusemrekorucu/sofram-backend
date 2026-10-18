import {
  Body,
  Controller,
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
import { CookOrdersService } from './cook-orders.service';
import { CompleteOrderDto, OrderReasonDto } from './dto/cook-order-actions.dto';
import { ListCookOrdersQueryDto } from './dto/list-orders.dto';
import { CookOrderCard, CookOrderDetail, CookOrderSummary } from './views';

/** The signed-in cook's incoming orders; no kitchen → 404. */
@ApiTags('Kitchen orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/orders',
  version: '1',
})
export class CookOrdersController {
  constructor(private readonly cookOrdersService: CookOrdersService) {}

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(CookOrderCard) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListCookOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CookOrderCard>> {
    return this.cookOrdersService.list(request.user.id, query);
  }

  // Before ':id' so "summary" is not taken for an order id.
  @Get('summary')
  @ApiOkResponse({ type: CookOrderSummary })
  summary(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<CookOrderSummary> {
    return this.cookOrdersService.summary(request.user.id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  detail(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.detail(request.user.id, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  accept(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.accept(request.user.id, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  reject(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.reject(request.user.id, id, dto.reason);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  start(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.start(request.user.id, id);
  }

  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  ready(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.ready(request.user.id, id);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  dispatch(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.dispatch(request.user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  complete(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteOrderDto,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.complete(request.user.id, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: CookOrderDetail })
  cancel(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<CookOrderDetail> {
    return this.cookOrdersService.cancel(request.user.id, id, dto.reason);
  }
}
