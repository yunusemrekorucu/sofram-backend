import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateKitchenDto } from './create-kitchen.dto';
import { UpdateKitchenDto } from './update-kitchen.dto';

const invalidFields = async (dto: new () => object, body: object) =>
  (await validate(plainToInstance(dto, body))).map((error) => error.property);

describe('minOrderKurus', () => {
  it('should accept 0 to 100000 kuruş and null', async () => {
    for (const minOrderKurus of [0, 15000, 100_000, null]) {
      expect(await invalidFields(UpdateKitchenDto, { minOrderKurus })).toEqual(
        [],
      );
    }
  });

  it('should reject negative, too large and fractional amounts', async () => {
    for (const minOrderKurus of [-1, 100_001, 150.5, '150']) {
      expect(await invalidFields(UpdateKitchenDto, { minOrderKurus })).toEqual([
        'minOrderKurus',
      ]);
    }
  });

  it('should be optional when the kitchen is opened', async () => {
    expect(
      await invalidFields(CreateKitchenDto, {
        name: 'Ayşe Teyze Mutfağı',
        addressId: '0b8f0c84-8f8a-4a8e-9a3b-2f7a1c6e5d4b',
        pickupEnabled: true,
        deliveryEnabled: false,
        deliveryTiers: [],
        hours: [],
      }),
    ).toEqual([]);
  });
});
