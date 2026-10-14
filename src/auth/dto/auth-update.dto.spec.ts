import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthUpdateDto } from './auth-update.dto';

const invalidFields = async (body: object) =>
  (await validate(plainToInstance(AuthUpdateDto, body))).map(
    (error) => error.property,
  );

describe('AuthUpdateDto.allergenPreferences', () => {
  it('should accept known allergens and an empty list', async () => {
    expect(
      await invalidFields({ allergenPreferences: ['milk', 'tree_nuts'] }),
    ).toEqual([]);
    expect(await invalidFields({ allergenPreferences: [] })).toEqual([]);
  });

  it('should reject unknown values and duplicates', async () => {
    expect(await invalidFields({ allergenPreferences: ['peanut'] })).toEqual([
      'allergenPreferences',
    ]);
    expect(
      await invalidFields({ allergenPreferences: ['milk', 'milk'] }),
    ).toEqual(['allergenPreferences']);
  });

  it('should reject a non-array', async () => {
    expect(await invalidFields({ allergenPreferences: 'milk' })).toEqual([
      'allergenPreferences',
    ]);
  });
});
