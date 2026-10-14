import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

// skipNullProperties: false → `{ "name": null }` is a 422; nullable fields
// (description, prepMinutes, portionsAvailable) keep their @IsOptional().
export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {}
