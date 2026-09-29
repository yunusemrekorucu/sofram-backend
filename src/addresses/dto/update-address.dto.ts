import { PartialType } from '@nestjs/swagger';
import { CreateAddressDto } from './create-address.dto';

// skipNullProperties: false → an omitted field is skipped, but an explicit
// null is still validated, so `{ "title": null }` is a 422 instead of reaching
// a NOT NULL column. Nullable fields keep their own @IsOptional().
export class UpdateAddressDto extends PartialType(CreateAddressDto, {
  skipNullProperties: false,
}) {}
