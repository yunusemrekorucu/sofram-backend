import { UnprocessableEntityException } from '@nestjs/common';
import { DevPhoneTokenVerifier } from './dev-phone-token-verifier';

describe('DevPhoneTokenVerifier', () => {
  const verifier = new DevPhoneTokenVerifier();

  it('should extract the E.164 number from a dev token', async () => {
    await expect(verifier.verify('dev:+905551112233')).resolves.toEqual({
      phoneNumber: '+905551112233',
    });
  });

  it.each(['+905551112233', 'dev:05551112233', 'dev:+0555', 'firebase-token'])(
    'should reject %s',
    async (token) => {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    },
  );
});
