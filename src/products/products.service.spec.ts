import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Allergen, DietTag, SaleType } from '../catalog/catalog.enums';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { Product } from './domain/product';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductRepository } from './infrastructure/persistence/product.repository';
import { ProductsService } from './products.service';

const KITCHEN = Object.assign(new Kitchen(), { id: 'k1', ownerId: 7 });
const MAIN = Object.assign(new Category(), { id: 'c1', isActive: true });
const file = (id: string) =>
  Object.assign(new FileType(), { id, path: `/${id}.png` });

const dto = (overrides: Partial<CreateProductDto> = {}): CreateProductDto => ({
  categoryId: 'c1',
  name: 'Ev Usulü Mantı',
  description: 'Yoğurtlu',
  priceKurus: 14000,
  saleType: SaleType.onDemand,
  prepMinutes: 45,
  allergens: [Allergen.milk, Allergen.gluten],
  dietTags: [],
  photoIds: ['f2', 'f1'],
  ...overrides,
});

const build = () => {
  const rows = new Map<string, Product>();
  const repository = {
    create: jest.fn().mockImplementation((data) => {
      const row = Object.assign(new Product(), data, {
        id: `p${rows.size + 1}`,
      });
      rows.set(row.id, row);
      return Promise.resolve(row);
    }),
    findByKitchenId: jest.fn(),
    findOwned: jest
      .fn()
      .mockImplementation((kitchenId, id) =>
        Promise.resolve(
          rows.get(id)?.kitchenId === kitchenId ? rows.get(id) : null,
        ),
      ),
    update: jest.fn().mockImplementation((id, data) => {
      const row = Object.assign(new Product(), data, { id });
      rows.set(id, row);
      return Promise.resolve(row);
    }),
    softDelete: jest.fn(),
    softDeleteByKitchenId: jest.fn(),
  };
  const kitchens = {
    findMine: jest.fn().mockResolvedValue(KITCHEN),
    findByOwner: jest.fn().mockResolvedValue(KITCHEN),
  };
  const categories = {
    findActive: jest
      .fn()
      .mockImplementation((id) => Promise.resolve(id === 'c1' ? MAIN : null)),
  };
  // The files table returns rows in its own order, not the requested one.
  const files = {
    findByIds: jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(
          ['f1', 'f2'].filter((id) => ids.includes(id)).map(file),
        ),
      ),
  };
  const service = new ProductsService(
    repository as unknown as ProductRepository,
    kitchens as unknown as KitchensService,
    categories as unknown as CategoriesService,
    files as unknown as FilesService,
  );
  return { service, repository, kitchens };
};

describe('ProductsService.createMine', () => {
  it('should build the product from the cook’s kitchen', async () => {
    const { service } = build();

    const product = await service.createMine(7, dto({ portionsAvailable: 3 }));

    expect(product).toMatchObject({
      kitchenId: 'k1',
      category: MAIN,
      prepMinutes: 45,
      portionsAvailable: null,
      isActive: true,
      searchText: 'ev usulu manti yogurtlu',
    });
    expect(product.photos.map((photo) => photo.id)).toEqual(['f2', 'f1']);
  });

  it('should require portions for a daily-portion product', async () => {
    const { service } = build();

    await expect(
      service.createMine(
        7,
        dto({ saleType: SaleType.dailyPortion, dietTags: [DietTag.vegan] }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should reject an unknown or inactive category', async () => {
    const { service } = build();

    await expect(
      service.createMine(7, dto({ categoryId: 'c9' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should reject a missing photo', async () => {
    const { service } = build();

    await expect(
      service.createMine(7, dto({ photoIds: ['f1', 'f9'] })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('ProductsService.updateMine', () => {
  it('should clear prepMinutes when switching to daily portions', async () => {
    const { service } = build();
    const created = await service.createMine(7, dto());

    const updated = await service.updateMine(7, created.id, {
      saleType: SaleType.dailyPortion,
      portionsAvailable: 5,
    });

    expect(updated).toMatchObject({
      name: 'Ev Usulü Mantı',
      prepMinutes: null,
      portionsAvailable: 5,
    });
  });

  it('should 404 a product of another kitchen', async () => {
    const { service, kitchens } = build();
    const created = await service.createMine(7, dto());
    kitchens.findMine.mockResolvedValue(
      Object.assign(new Kitchen(), { id: 'k2' }),
    );

    await expect(
      service.updateMine(8, created.id, { priceKurus: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProductsService.removeAllForOwner', () => {
  it('should do nothing for a user without a kitchen', async () => {
    const { service, repository, kitchens } = build();
    kitchens.findByOwner.mockResolvedValue(null);

    await service.removeAllForOwner(7);

    expect(repository.softDeleteByKitchenId).not.toHaveBeenCalled();
  });

  it('should soft-delete every product of the kitchen', async () => {
    const { service, repository } = build();

    await service.removeAllForOwner(7);

    expect(repository.softDeleteByKitchenId).toHaveBeenCalledWith('k1');
  });
});
