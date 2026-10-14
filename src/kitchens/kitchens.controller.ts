import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { Kitchen } from './domain/kitchen';
import { CreateKitchenDto } from './dto/create-kitchen.dto';
import { UpdateKitchenDto } from './dto/update-kitchen.dto';
import { KitchensService } from './kitchens.service';

/** The signed-in cook's kitchen; customers read kitchens via /discover. */
@ApiTags('Kitchens')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'kitchens/me',
  version: '1',
})
export class KitchensController {
  constructor(private readonly kitchensService: KitchensService) {}

  @Post()
  @ApiCreatedResponse({ type: Kitchen })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: CreateKitchenDto,
  ): Promise<Kitchen> {
    return this.kitchensService.create(request.user.id, dto);
  }

  @Get()
  @ApiOkResponse({ type: Kitchen })
  findMine(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<Kitchen> {
    return this.kitchensService.findMine(request.user.id);
  }

  @Patch()
  @ApiOkResponse({ type: Kitchen })
  update(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() dto: UpdateKitchenDto,
  ): Promise<Kitchen> {
    return this.kitchensService.update(request.user.id, dto);
  }
}
