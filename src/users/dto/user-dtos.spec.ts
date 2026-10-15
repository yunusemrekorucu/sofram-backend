import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

const errorsFor = async (
  cls: typeof CreateUserDto | typeof UpdateUserDto,
  value: unknown,
) => {
  const plain: Record<string, unknown> = {
    email: 'a@example.com',
    password: 'secret1',
  };
  if (value !== undefined) {
    plain.allergenPreferences = value;
  }
  const errors = await validate(plainToInstance(cls, plain));
  return errors.filter((error) => error.property === 'allergenPreferences');
};

describe.each([
  ['CreateUserDto', CreateUserDto],
  ['UpdateUserDto', UpdateUserDto],
])('%s allergenPreferences', (_name, cls) => {
  it('should reject null', async () => {
    expect(await errorsFor(cls, null)).not.toHaveLength(0);
  });

  it('should accept absence', async () => {
    expect(await errorsFor(cls, undefined)).toHaveLength(0);
  });

  it('should accept a known allergen', async () => {
    expect(await errorsFor(cls, ['milk'])).toHaveLength(0);
  });

  it('should reject an unknown allergen', async () => {
    expect(await errorsFor(cls, ['peanut'])).not.toHaveLength(0);
  });
});
