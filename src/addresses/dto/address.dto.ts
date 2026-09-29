import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AddressDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;
}
