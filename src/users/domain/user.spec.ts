import { instanceToPlain } from 'class-transformer';
import { User } from './user';

const user = () =>
  Object.assign(new User(), {
    id: 7,
    firstName: 'Ayşe',
    marketingConsent: true,
    kvkkAcceptedAt: new Date('2026-09-30T10:00:00Z'),
  });

describe('User serialization groups', () => {
  it('should show marketing consent to the user and admins only', () => {
    expect(instanceToPlain(user(), { groups: ['me'] })).toHaveProperty(
      'marketingConsent',
      true,
    );
    expect(instanceToPlain(user(), { groups: ['admin'] })).toHaveProperty(
      'marketingConsent',
      true,
    );
    expect(instanceToPlain(user())).not.toHaveProperty('marketingConsent');
  });

  it('should show the KVKK consent time to admins only', () => {
    expect(instanceToPlain(user(), { groups: ['admin'] })).toHaveProperty(
      'kvkkAcceptedAt',
    );
    expect(instanceToPlain(user(), { groups: ['me'] })).not.toHaveProperty(
      'kvkkAcceptedAt',
    );
    expect(instanceToPlain(user())).not.toHaveProperty('kvkkAcceptedAt');
  });
});
