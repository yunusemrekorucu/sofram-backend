import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { Product } from './domain/product';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

/** The signed-in cook's menu; customers read products via /discover. */
@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me/products',
  version: '1',
})
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOkResponse({ type: Product, isArray: true })
  findAll(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<Product[]> {
    return this.productsService.listMine(request.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: Product })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: CreateProductDto,
  ): Promise<Product> {
    return this.productsService.createMine(request.user.id, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: Product })
  update(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<Product> {
    return this.productsService.updateMine(request.user.id, id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.productsService.removeMine(request.user.id, id);
  }
}
