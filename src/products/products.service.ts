import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { assertNoFieldErrors } from '../catalog/field-errors';
import { foldTurkish } from '../catalog/fold-turkish';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/domain/category';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { KitchensService } from '../kitchens/kitchens.service';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { Product } from './domain/product';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductRepository } from './infrastructure/persistence/product.repository';
import { normalizeSale } from './product-rules';

/** What the cook controls; searchText derives from it. */
type ProductFields = Omit<
  Product,
  'id' | 'createdAt' | 'updatedAt' | 'searchText'
>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly kitchensService: KitchensService,
    private readonly categoriesService: CategoriesService,
    private readonly filesService: FilesService,
  ) {}

  /** Order quotes: the requested products that still exist, any kitchen. */
  findByIds(ids: Product['id'][]): Promise<Product[]> {
    return this.productRepository.findByIds(ids);
  }

  async listMine(ownerId: User['id']): Promise<Product[]> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return this.productRepository.findByKitchenId(kitchen.id);
  }

  async createMine(
    ownerId: User['id'],
    dto: CreateProductDto,
  ): Promise<Product> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    const { categoryId, photoIds, ...fields } = dto;

    return this.productRepository.create(
      this.withDerived({
        ...fields,
        kitchenId: kitchen.id,
        category: await this.activeCategory(categoryId),
        photos: await this.photos(photoIds),
        description: fields.description ?? null,
        prepMinutes: fields.prepMinutes ?? null,
        portionsAvailable: fields.portionsAvailable ?? null,
        isActive: fields.isActive ?? true,
      }),
    );
  }

  async updateMine(
    ownerId: User['id'],
    id: Product['id'],
    dto: UpdateProductDto,
  ): Promise<Product> {
    const current = await this.findMine(ownerId, id);
    const { categoryId, photoIds, ...changes } = dto;
    const next: ProductFields = { ...current, ...changes };

    if (categoryId !== undefined) {
      next.category = await this.activeCategory(categoryId);
    }

    if (photoIds !== undefined) {
      next.photos = await this.photos(photoIds);
    }

    return this.productRepository.update(id, this.withDerived(next));
  }

  async removeMine(ownerId: User['id'], id: Product['id']): Promise<void> {
    await this.findMine(ownerId, id);
    await this.productRepository.softDelete(id);
  }

  /** Account deletion; runs before KitchensService.removeForOwner. */
  async removeAllForOwner(ownerId: User['id']): Promise<void> {
    const kitchen = await this.kitchensService.findByOwner(ownerId);

    if (kitchen) {
      await this.productRepository.softDeleteByKitchenId(kitchen.id);
    }
  }

  private async findMine(
    ownerId: User['id'],
    id: Product['id'],
  ): Promise<Product> {
    const kitchen = await this.kitchensService.findMine(ownerId);
    return orNotFound(this.productRepository.findOwned(kitchen.id, id));
  }

  private withDerived(
    fields: ProductFields,
  ): ProductFields & Pick<Product, 'searchText'> {
    const { sale, errors } = normalizeSale(fields);
    assertNoFieldErrors(errors);

    return {
      ...fields,
      ...sale,
      searchText: foldTurkish(
        [fields.name, fields.description].filter(Boolean).join(' '),
      ),
    };
  }

  private async activeCategory(id: Category['id']): Promise<Category> {
    const category = await this.categoriesService.findActive(id);

    if (!category) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { categoryId: 'notExists' },
      });
    }

    return category;
  }

  /** In the requested order — the first one is the card photo. */
  private async photos(ids: string[]): Promise<FileType[]> {
    const byId = new Map(
      (await this.filesService.findByIds(ids)).map((file) => [file.id, file]),
    );

    if (ids.some((id) => !byId.has(id))) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { photoIds: 'imageNotExists' },
      });
    }

    return ids.map((id) => byId.get(id) as FileType);
  }
}
