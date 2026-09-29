import { HttpStatus, NotFoundException } from '@nestjs/common';

/**
 * Ownership checks look records up scoped to the caller and use this, so a
 * record that belongs to someone else is indistinguishable from a missing one.
 */
export async function orNotFound<T>(lookup: Promise<T | null>): Promise<T> {
  const value = await lookup;

  if (value === null) {
    throw new NotFoundException({
      status: HttpStatus.NOT_FOUND,
      error: 'notFound',
    });
  }

  return value;
}
