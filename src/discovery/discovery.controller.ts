import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { DiscoveryService } from './discovery.service';
import { DiscoverQueryDto, PointQueryDto } from './dto/discover-query.dto';
import {
  KitchenCard,
  KitchenDetail,
  ProductCard,
  ProductDetail,
} from './views';

@ApiTags('Discovery')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'discover',
  version: '1',
})
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('kitchens')
  @ApiOkResponse({ type: InfinityPaginationResponse(KitchenCard) })
  kitchens(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    return this.discoveryService.kitchens(request.user.id, query);
  }

  @Get('products')
  @ApiOkResponse({ type: InfinityPaginationResponse(ProductCard) })
  products(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: DiscoverQueryDto,
  ): Promise<InfinityPaginationResponseDto<ProductCard>> {
    return this.discoveryService.products(request.user.id, query);
  }

  @Get('kitchens/:id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: KitchenDetail })
  kitchen(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() point: PointQueryDto,
  ): Promise<KitchenDetail> {
    return this.discoveryService.kitchen(request.user.id, id, point);
  }

  @Get('products/:id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: ProductDetail })
  product(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() point: PointQueryDto,
  ): Promise<ProductDetail> {
    return this.discoveryService.product(request.user.id, id, point);
  }
}
