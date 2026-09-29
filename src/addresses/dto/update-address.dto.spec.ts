import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAddressDto } from './update-address.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateAddressDto, body))).map(
    (e) => e.property,
  );

describe('UpdateAddressDto', () => {
  it('should accept a partial update', async () => {
    expect(await errorsFor({ title: 'Ev' })).toEqual([]);
  });

  it.each([
    'title',
    'fullAddress',
    'district',
    'neighborhood',
    'latitude',
    'longitude',
  ])('should reject null for the required field %s', async (field) => {
    expect(await errorsFor({ [field]: null })).toEqual([field]);
  });

  it.each(['directions', 'apartmentNo', 'floor', 'buildingNo', 'isDefault'])(
    'should still allow null for the optional field %s',
    async (field) => {
      expect(await errorsFor({ [field]: null })).toEqual([]);
    },
  );
});
