export type VerifiedPhone = { phoneNumber: string };

/**
 * Turns the client's phone-auth token into a verified E.164 number. Firebase
 * Phone Auth plugs in here (firebase-admin → verifyIdToken → phone_number);
 * nothing else in the login flow changes.
 */
export abstract class PhoneTokenVerifier {
  abstract verify(idToken: string): Promise<VerifiedPhone>;
}
