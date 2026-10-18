import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { OrderReason } from '../order.enums';

/** reject and the cook's cancel. */
export class OrderReasonDto {
  @ApiProperty({ enum: OrderReason })
  @IsEnum(OrderReason)
  reason: OrderReason;
}

export class CompleteOrderDto {
  @ApiPropertyOptional({
    example: '0427',
    description: 'Gel-al siparişinde zorunlu: müşterinin gösterdiği 4 hane',
  })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'invalid' })
  pickupCode?: string;
}
