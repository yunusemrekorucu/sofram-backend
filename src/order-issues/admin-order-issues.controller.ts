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
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import {
  ListOrderIssuesQueryDto,
  ResolveOrderIssueDto,
} from './dto/admin-order-issues.dto';
import { OrderIssuesService } from './order-issues.service';
import { AdminIssueView } from './views';

/** Swagger-only support desk (no admin panel). */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({
  path: 'admin/issues',
  version: '1',
})
export class AdminOrderIssuesController {
  constructor(private readonly orderIssuesService: OrderIssuesService) {}

  @Get()
  @ApiOkResponse({ type: InfinityPaginationResponse(AdminIssueView) })
  list(
    @Query() query: ListOrderIssuesQueryDto,
  ): Promise<InfinityPaginationResponseDto<AdminIssueView>> {
    return this.orderIssuesService.list(query);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: AdminIssueView })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveOrderIssueDto,
  ): Promise<AdminIssueView> {
    return this.orderIssuesService.resolve(id, dto);
  }
}
