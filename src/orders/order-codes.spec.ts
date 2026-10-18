import {
  ORDER_CODE_ALPHABET,
  generateOrderCode,
  generatePickupCode,
} from './order-codes';

describe('generateOrderCode', () => {
  it('should be S- and four characters from the unambiguous alphabet', () => {
    for (let run = 0; run < 200; run++) {
      expect(generateOrderCode()).toMatch(/^S-[23456789A-HJKMNP-Z]{4}$/);
    }
  });

  it('should leave out 0, 1, I, L and O', () => {
    expect(ORDER_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(ORDER_CODE_ALPHABET).toHaveLength(31);
  });

  it('should use the given random source', () => {
    expect(generateOrderCode(() => 0)).toBe('S-2222');
    expect(generateOrderCode((max) => max - 1)).toBe('S-ZZZZ');
  });
});

describe('generatePickupCode', () => {
  it('should be four digits, zero-padded', () => {
    expect(generatePickupCode(() => 7)).toBe('0007');
    expect(generatePickupCode((max) => max - 1)).toBe('9999');
    expect(generatePickupCode()).toMatch(/^\d{4}$/);
  });
});
