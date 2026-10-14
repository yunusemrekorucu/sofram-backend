import { PartialType } from '@nestjs/swagger';
import { CreateCategoryDto } from './create-category.dto';

// skipNullProperties: false → an explicit null on a NOT NULL column is a 422.
export class UpdateCategoryDto extends PartialType(CreateCategoryDto, {
  skipNullProperties: false,
}) {}
