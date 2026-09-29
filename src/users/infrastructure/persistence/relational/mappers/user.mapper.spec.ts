import { UserEntity } from '../entities/user.entity';
import { UserMapper } from './user.mapper';

const entity = (overrides: Partial<UserEntity>): UserEntity =>
  Object.assign(new UserEntity(), {
    id: 1,
    email: null,
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    kvkkAcceptedAt: new Date('2026-09-30T10:00:00Z'),
    ...overrides,
  });

describe('UserMapper.toDomain profileCompleted', () => {
  it('should be true with first name, last name and KVKK consent', () => {
    expect(UserMapper.toDomain(entity({})).profileCompleted).toBe(true);
  });

  it.each([
    ['first name', { firstName: null }],
    ['last name', { lastName: null }],
    ['KVKK consent', { kvkkAcceptedAt: null }],
  ])('should be false without %s', (_label, overrides) => {
    expect(UserMapper.toDomain(entity(overrides)).profileCompleted).toBe(false);
  });
});
