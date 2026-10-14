import { UnprocessableEntityException } from '@nestjs/common';
import { assertNoFieldErrors } from './field-errors';

describe('assertNoFieldErrors', () => {
  it('should pass when there are no errors', () => {
    expect(() => assertNoFieldErrors({})).not.toThrow();
  });

  it('should throw the boilerplate 422 shape with dotted keys intact', () => {
    const run = () =>
      assertNoFieldErrors({ 'deliveryTiers.1.upToKm': 'mustIncrease' });
    let response: unknown;

    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      response = (error as UnprocessableEntityException).getResponse();
    }

    expect(response).toEqual({
      status: 422,
      errors: { 'deliveryTiers.1.upToKm': 'mustIncrease' },
    });
  });
});
