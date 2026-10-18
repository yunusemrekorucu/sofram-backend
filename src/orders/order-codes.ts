import { randomInt } from 'crypto';

/** No 0/O or 1/I/L: the code is read aloud and typed back. */
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A uniform integer in [0, max). */
export type RandomInt = (max: number) => number;

const secureRandom: RandomInt = (max) => randomInt(max);

/** Display code `S-7K3F`; the order repository retries on a collision. */
export function generateOrderCode(random: RandomInt = secureRandom): string {
  let code = 'S-';

  for (let index = 0; index < 4; index++) {
    code += ORDER_CODE_ALPHABET[random(ORDER_CODE_ALPHABET.length)];
  }

  return code;
}

/** Four digits the customer shows and the cook types to complete a pickup. */
export function generatePickupCode(random: RandomInt = secureRandom): string {
  return String(random(10_000)).padStart(4, '0');
}
