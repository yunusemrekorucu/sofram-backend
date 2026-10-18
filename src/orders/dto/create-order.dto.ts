import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderItemInputDto, OrderTargetDto } from './quote-order.dto';

export class CreateOrderItemDto extends OrderItemInputDto {
  @ApiPropertyOptional({ nullable: true, example: 'Az acılı olsun' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  note?: string | null;
}

export class CreateOrderDto extends OrderTargetDto {
  @ApiProperty({ type: () => CreateOrderItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((item: CreateOrderItemDto) => item.productId)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiProperty({
    description:
      'Son teklifin totalKurus değeri; farklıysa 409 orderTotalChanged',
  })
  @IsInt()
  @Min(0)
  expectedTotalKurus: number;

  @ApiProperty({ description: 'Mesafeli satış sözleşmesi onayı; true olmalı' })
  @Equals(true, { message: 'mustBeAccepted' })
  acceptedTerms: boolean;
}
