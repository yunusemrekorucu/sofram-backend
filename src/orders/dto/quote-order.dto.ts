import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Fulfillment } from '../order.enums';

export class OrderItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: 20, example: 2 })
  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

/** Where the order goes; shared by the quote and the order. */
export class OrderTargetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  kitchenId: string;

  @ApiProperty({ enum: Fulfillment })
  @IsEnum(Fulfillment)
  fulfillment: Fulfillment;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Teslimatta zorunlu; kullanıcının adreslerinden biri',
  })
  @ValidateIf((dto: OrderTargetDto) => dto.fulfillment === Fulfillment.delivery)
  @IsUUID()
  addressId?: string;
}

export class QuoteOrderDto extends OrderTargetDto {
  @ApiProperty({ type: () => OrderItemInputDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: OrderItemInputDto) => item.productId, {
    message: 'mustBeUnique',
  })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}
