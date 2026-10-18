import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CookTab, OrderScope } from '../order.enums';

class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ListOrdersQueryDto extends PageQueryDto {
  @ApiProperty({ enum: OrderScope })
  @IsEnum(OrderScope)
  scope: OrderScope;
}

export class ListCookOrdersQueryDto extends PageQueryDto {
  @ApiProperty({ enum: CookTab })
  @IsEnum(CookTab)
  tab: CookTab;
}
