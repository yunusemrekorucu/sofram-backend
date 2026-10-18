import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CookTab, OrderScope } from '../order.enums';

/** page ≤ 1000, limit ≤ 50 (Faz 2 §8); shared by every infinite list. */
export class PageQueryDto {
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
