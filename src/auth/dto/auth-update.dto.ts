import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  ValidateIf,
  IsArray,
  IsBoolean,
  IsEnum,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  MinLength,
} from 'class-validator';
import { Allergen } from '../../catalog/catalog.enums';
import { FileDto } from '../../files/dto/file.dto';
import { Transform } from 'class-transformer';
import { lowerCaseTransformer } from '../../utils/transformers/lower-case.transformer';

export class AuthUpdateDto {
  @ApiPropertyOptional({ type: () => FileDto })
  @IsOptional()
  photo?: FileDto | null;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsNotEmpty({ message: 'mustBeNotEmpty' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsNotEmpty({ message: 'mustBeNotEmpty' })
  lastName?: string;

  @ApiPropertyOptional({ example: 'new.email@example.com' })
  @IsOptional()
  @IsNotEmpty()
  @IsEmail()
  @Transform(lowerCaseTransformer)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty({ message: 'mustBeNotEmpty' })
  oldPassword?: string;

  @ApiPropertyOptional({
    description: 'true gönderildiğinde KVKK onay zamanı (ilk kez) kaydedilir',
  })
  @IsOptional()
  @IsBoolean()
  kvkkAccepted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @ApiPropertyOptional({ enum: Allergen, isArray: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsEnum(Allergen, { each: true })
  allergenPreferences?: Allergen[];
}
