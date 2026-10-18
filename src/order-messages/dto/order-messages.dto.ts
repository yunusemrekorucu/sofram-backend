import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** GET …/messages?after= — the createdAt of the last message the client has. */
export class ListOrderMessagesQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Yalnız bundan sonra yazılanlar',
  })
  @IsOptional()
  @IsISO8601()
  after?: string;
}

/** POST …/messages */
export class SendOrderMessageDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;
}
