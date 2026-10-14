import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateKitchenDto } from './create-kitchen.dto';

// skipNullProperties: false → `{ "name": null }` is a 422; nullable fields
// (description, coverPhotoId, freeDeliveryMinKurus) keep their @IsOptional().
export class UpdateKitchenDto extends PartialType(CreateKitchenDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isPaused?: boolean;
}
