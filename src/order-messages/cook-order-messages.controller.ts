import {
  Body,
  Controller,
  Get,
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
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import {
  ListOrderMessagesQueryDto,
  SendOrderMessageDto,
} from './dto/order-messages.dto';
import { OrderMessagesService } from './order-messages.service';
import { OrderMessageView, OrderMessagesView } from './views';

/** The cook's side of the order chat; no kitchen → 404. */
@ApiTags('Kitchen orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/orders',
  version: '1',
})
export class CookOrderMessagesController {
  constructor(private readonly orderMessagesService: OrderMessagesService) {}

  @Get(':id/messages')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: OrderMessagesView })
  read(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListOrderMessagesQueryDto,
  ): Promise<OrderMessagesView> {
    return this.orderMessagesService.readAsCook(
      request.user.id,
      id,
      query.after,
    );
  }

  @Post(':id/messages')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: OrderMessageView })
  send(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendOrderMessageDto,
  ): Promise<OrderMessageView> {
    return this.orderMessagesService.sendAsCook(request.user.id, id, dto.body);
  }
}
