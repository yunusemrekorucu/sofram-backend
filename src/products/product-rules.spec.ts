import { SaleType } from '../catalog/catalog.enums';
import { normalizeSale } from './product-rules';

describe('normalizeSale', () => {
  it('should keep prepMinutes and clear portions for on-demand', () => {
    expect(
      normalizeSale({
        saleType: SaleType.onDemand,
        prepMinutes: 45,
        portionsAvailable: 10,
      }),
    ).toEqual({
      sale: {
        saleType: SaleType.onDemand,
        prepMinutes: 45,
        portionsAvailable: null,
      },
      errors: {},
    });
  });

  it('should keep portions and clear prepMinutes for daily portions', () => {
    expect(
      normalizeSale({
        saleType: SaleType.dailyPortion,
        prepMinutes: 45,
        portionsAvailable: 0,
      }),
    ).toEqual({
      sale: {
        saleType: SaleType.dailyPortion,
        prepMinutes: null,
        portionsAvailable: 0,
      },
      errors: {},
    });
  });

  it('should require the field that belongs to the sale type', () => {
    expect(normalizeSale({ saleType: SaleType.onDemand }).errors).toEqual({
      prepMinutes: 'required',
    });
    expect(
      normalizeSale({
        saleType: SaleType.dailyPortion,
        portionsAvailable: null,
      }).errors,
    ).toEqual({ portionsAvailable: 'required' });
  });
});
