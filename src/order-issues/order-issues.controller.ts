import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { CreateOrderIssueDto } from './dto/create-order-issue.dto';
import { OrderIssuesService } from './order-issues.service';
import { IssueView } from './views';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'orders',
  version: '1',
})
export class OrderIssuesController {
  constructor(private readonly orderIssuesService: OrderIssuesService) {}

  @Post(':id/issues')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiCreatedResponse({ type: IssueView })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOrderIssueDto,
  ): Promise<IssueView> {
    return this.orderIssuesService.create(request.user.id, id, dto);
  }
}
