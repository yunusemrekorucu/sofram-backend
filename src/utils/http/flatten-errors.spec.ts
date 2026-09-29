import { flattenErrors } from './flatten-errors';

describe('flattenErrors', () => {
  it('should turn a nested error tree into dot-path field errors', () => {
    expect(
      flattenErrors({
        email: 'notFound',
        address: { district: 'required', geo: { lat: 'isNumber' } },
      }),
    ).toEqual([
      { field: 'email', message: 'notFound' },
      { field: 'address.district', message: 'required' },
      { field: 'address.geo.lat', message: 'isNumber' },
    ]);
  });

  it('should return an empty list for an empty tree', () => {
    expect(flattenErrors({})).toEqual([]);
  });
});
