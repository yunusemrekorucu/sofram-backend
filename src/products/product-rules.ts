import { SaleType } from '../catalog/catalog.enums';
import { FieldErrors } from '../catalog/field-errors';

export type SaleInput = {
  saleType: SaleType;
  prepMinutes?: number | null;
  portionsAvailable?: number | null;
};

export type SaleFields = {
  saleType: SaleType;
  prepMinutes: number | null;
  portionsAvailable: number | null;
};

/**
 * The field that belongs to the sale type is required; the other one is
 * cleared, so switching types never needs the client to null the old field.
 */
export function normalizeSale(input: SaleInput): {
  sale: SaleFields;
  errors: FieldErrors;
} {
  const prepMinutes = input.prepMinutes ?? null;
  const portionsAvailable = input.portionsAvailable ?? null;

  if (input.saleType === SaleType.onDemand) {
    return {
      sale: { saleType: input.saleType, prepMinutes, portionsAvailable: null },
      errors: prepMinutes === null ? { prepMinutes: 'required' } : {},
    };
  }

  return {
    sale: { saleType: input.saleType, prepMinutes: null, portionsAvailable },
    errors: portionsAvailable === null ? { portionsAvailable: 'required' } : {},
  };
}
