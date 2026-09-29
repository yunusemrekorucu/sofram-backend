import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AuthPhoneLoginDto {
  @ApiProperty({ example: 'dev:+905551112233' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
