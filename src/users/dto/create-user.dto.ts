import {
  // decorators here
  Transform,
  Type,
} from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  // decorators here
  ArrayUnique,
  ValidateIf,
  IsArray,
  IsEnum,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  MinLength,
  IsString,
  IsBoolean,
  Matches,
} from 'class-validator';
import { Allergen } from '../../catalog/catalog.enums';
import { FileDto } from '../../files/dto/file.dto';
import { RoleDto } from '../../roles/dto/role.dto';
import { StatusDto } from '../../statuses/dto/status.dto';
import { lowerCaseTransformer } from '../../utils/transformers/lower-case.transformer';

export class CreateUserDto {
  @ApiPropertyOptional({ enum: Allergen, isArray: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsEnum(Allergen, { each: true })
  allergenPreferences?: Allergen[];

  @ApiProperty({
    required: false,
    type: () => Boolean,
  })
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  kvkkAcceptedAt?: Date | null;

  @ApiProperty({
    required: false,
    type: () => String,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'invalidPhoneNumber' })
  phoneNumber?: string | null;

  @ApiProperty({ example: 'test1@example.com', type: String })
  @Transform(lowerCaseTransformer)
  @IsNotEmpty()
  @IsEmail()
  email: string | null;

  @ApiProperty()
  @MinLength(6)
  password?: string;

  provider?: string;

  socialId?: string | null;

  @ApiProperty({ example: 'John', type: String })
  @IsNotEmpty()
  firstName: string | null;

  @ApiProperty({ example: 'Doe', type: String })
  @IsNotEmpty()
  lastName: string | null;

  @ApiPropertyOptional({ type: () => FileDto })
  @IsOptional()
  photo?: FileDto | null;

  @ApiPropertyOptional({ type: RoleDto })
  @IsOptional()
  @Type(() => RoleDto)
  role?: RoleDto | null;

  @ApiPropertyOptional({ type: StatusDto })
  @IsOptional()
  @Type(() => StatusDto)
  status?: StatusDto;
}
