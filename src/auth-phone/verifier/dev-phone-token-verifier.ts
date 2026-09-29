import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PhoneTokenVerifier, VerifiedPhone } from './phone-token-verifier';

const DEV_TOKEN = /^dev:(\+[1-9]\d{7,14})$/;

/** Accepts `dev:<E.164>` — what the mobile dev PhoneAuthService sends. Never bound in production. */
@Injectable()
export class DevPhoneTokenVerifier extends PhoneTokenVerifier {
  verify(idToken: string): Promise<VerifiedPhone> {
    const match = DEV_TOKEN.exec(idToken);

    if (!match) {
      return Promise.reject(
        new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { idToken: 'invalidPhoneToken' },
        }),
      );
    }

    return Promise.resolve({ phoneNumber: match[1] });
  }
}
