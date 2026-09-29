import { NotFoundException } from '@nestjs/common';
import { orNotFound } from './or-not-found';

describe('orNotFound', () => {
  it('should pass a found value through', async () => {
    await expect(orNotFound(Promise.resolve({ id: 1 }))).resolves.toEqual({
      id: 1,
    });
  });

  it('should turn null into a 404', async () => {
    await expect(orNotFound(Promise.resolve(null))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
