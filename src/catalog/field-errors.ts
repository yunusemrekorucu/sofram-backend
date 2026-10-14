import { HttpStatus, UnprocessableEntityException } from '@nestjs/common';

/** `{ 'hours.2.closesAt': 'mustBeAfterOpensAt' }` — flattened as-is by AllExceptionsFilter. */
export type FieldErrors = Record<string, string>;

export function assertNoFieldErrors(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors,
    });
  }
}
