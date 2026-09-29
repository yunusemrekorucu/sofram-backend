import { UserDto } from '../../users/dto/user.dto';

import {
  // decorators here

  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  Max,
  Min,
} from 'class-validator';

import {
  // decorators here
  ApiProperty,
} from '@nestjs/swagger';

export class CreateAddressDto {
  user?: UserDto;

  @ApiProperty({
    required: false,
    type: () => Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    required: true,
    type: () => Number,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    required: true,
    type: () => Number,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  directions?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  apartmentNo?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  floor?: string | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  buildingNo?: string | null;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  @IsNotEmpty()
  neighborhood: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  @IsNotEmpty()
  district: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  @IsNotEmpty()
  fullAddress: string;

  @ApiProperty({
    required: true,
    type: () => String,
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  // Don't forget to use the class-validator decorators in the DTO properties.
}
