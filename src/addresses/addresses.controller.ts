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
import { AddressesService } from './addresses.service';
import { Address } from './domain/address';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/** Every route is scoped to the signed-in user; the id comes from the JWT. */
@ApiTags('Addresses')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller({
  path: 'addresses',
  version: '1',
})
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  @ApiOkResponse({ type: Address, isArray: true })
  findAll(
    @Request() request: RequestWithUser<JwtPayloadType>,
  ): Promise<Address[]> {
    return this.addressesService.findAllForUser(request.user.id);
  }

  @Post()
  @ApiCreatedResponse({ type: Address })
  create(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Body() createAddressDto: CreateAddressDto,
  ): Promise<Address> {
    return this.addressesService.create(request.user.id, createAddressDto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiOkResponse({ type: Address })
  update(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAddressDto: UpdateAddressDto,
  ): Promise<Address> {
    return this.addressesService.update(request.user.id, id, updateAddressDto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', type: String, required: true })
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() request: RequestWithUser<JwtPayloadType>,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.addressesService.remove(request.user.id, id);
  }
}
