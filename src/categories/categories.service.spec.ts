import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Category } from './domain/category';
import { CategoryRepository } from './infrastructure/persistence/category.repository';

const aCategory = (overrides: Partial<Category> = {}): Category =>
  Object.assign(new Category(), {
    id: 'c1',
    slug: 'soup',
    nameTr: 'Çorba',
    nameEn: 'Soup',
    icon: null,
    sortOrder: 0,
    isActive: true,
    ...overrides,
  });

const build = () => {
  const repository = {
    create: jest.fn().mockImplementation((data) => aCategory(data)),
    findActive: jest.fn(),
    findById: jest.fn().mockResolvedValue(null),
    findBySlug: jest.fn().mockResolvedValue(null),
    update: jest
      .fn()
      .mockImplementation((id, data) => aCategory({ id, ...data })),
  };
  const service = new CategoriesService(
    repository as unknown as CategoryRepository,
  );
  return { service, repository };
};

describe('CategoriesService', () => {
  it('should default sortOrder, isActive and icon on create', async () => {
    const { service, repository } = build();

    await service.create({ slug: 'soup', nameTr: 'Çorba', nameEn: 'Soup' });

    expect(repository.create).toHaveBeenCalledWith({
      slug: 'soup',
      nameTr: 'Çorba',
      nameEn: 'Soup',
      icon: null,
      sortOrder: 0,
      isActive: true,
    });
  });

  it('should refuse a taken slug with a field error', async () => {
    const { service, repository } = build();
    repository.findBySlug.mockResolvedValue(aCategory({ id: 'other' }));

    await expect(
      service.create({ slug: 'soup', nameTr: 'Çorba', nameEn: 'Soup' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should allow keeping its own slug on update', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue(aCategory());
    repository.findBySlug.mockResolvedValue(aCategory());

    await expect(service.update('c1', { slug: 'soup' })).resolves.toMatchObject(
      { id: 'c1' },
    );
  });

  it('should 404 an unknown category on update', async () => {
    const { service } = build();

    await expect(
      service.update('nope', { nameTr: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should hide an inactive category from findActive', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue(aCategory({ isActive: false }));

    await expect(service.findActive('c1')).resolves.toBeNull();
  });
});
