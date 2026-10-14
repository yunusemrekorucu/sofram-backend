import {
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { orNotFound } from '../utils/or-not-found';
import { Category } from './domain/category';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryRepository } from './infrastructure/persistence/category.repository';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoryRepository: CategoryRepository) {}

  listActive(): Promise<Category[]> {
    return this.categoryRepository.findActive();
  }

  /** null when missing or deactivated — products may only use active ones. */
  async findActive(id: Category['id']): Promise<Category | null> {
    const category = await this.categoryRepository.findById(id);
    return category?.isActive ? category : null;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    await this.assertSlugFree(dto.slug);

    return this.categoryRepository.create({
      slug: dto.slug,
      nameTr: dto.nameTr,
      nameEn: dto.nameEn,
      icon: dto.icon ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
  }

  async update(id: Category['id'], dto: UpdateCategoryDto): Promise<Category> {
    await orNotFound(this.categoryRepository.findById(id));

    if (dto.slug !== undefined) {
      await this.assertSlugFree(dto.slug, id);
    }

    return this.categoryRepository.update(id, dto);
  }

  private async assertSlugFree(
    slug: Category['slug'],
    ownId?: Category['id'],
  ): Promise<void> {
    const holder = await this.categoryRepository.findBySlug(slug);

    if (holder && holder.id !== ownId) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { slug: 'alreadyExists' },
      });
    }
  }
}
