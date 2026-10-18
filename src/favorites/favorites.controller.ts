import {
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import { KitchenCard } from '../discovery/views';
import {
  InfinityPaginationResponse,
  InfinityPaginationResponseDto,
} from '../utils/dto/infinity-pagination-response.dto';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { ListFavoritesQueryDto } from './dto/list-favorites.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('Favorites')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  version: '1',
})
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post('kitchens/:id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  add(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.favoritesService.add(request.user.id, id);
  }

  @Delete('kitchens/:id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.favoritesService.remove(request.user.id, id);
  }

  @Get('favorites')
  @ApiOkResponse({ type: InfinityPaginationResponse(KitchenCard) })
  list(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Query() query: ListFavoritesQueryDto,
  ): Promise<InfinityPaginationResponseDto<KitchenCard>> {
    return this.favoritesService.list(request.user.id, query);
  }
}
