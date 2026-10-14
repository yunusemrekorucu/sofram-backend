import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Category } from '../../../../domain/category';
import { CategoryRepository } from '../../category.repository';
import { CategoryEntity } from '../entities/category.entity';
import { CategoryMapper } from '../mappers/category.mapper';

@Injectable()
export class CategoryRelationalRepository implements CategoryRepository {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  async create(
    data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Category> {
    const entity = await this.categoryRepository.save(
      this.categoryRepository.create(CategoryMapper.toPersistence(data)),
    );
    return CategoryMapper.toDomain(entity);
  }

  async findActive(): Promise<Category[]> {
    const entities = await this.categoryRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', nameTr: 'ASC' },
    });
    return entities.map((entity) => CategoryMapper.toDomain(entity));
  }

  async findById(id: Category['id']): Promise<NullableType<Category>> {
    const entity = await this.categoryRepository.findOne({ where: { id } });
    return entity ? CategoryMapper.toDomain(entity) : null;
  }

  async findBySlug(slug: Category['slug']): Promise<NullableType<Category>> {
    const entity = await this.categoryRepository.findOne({ where: { slug } });
    return entity ? CategoryMapper.toDomain(entity) : null;
  }

  async update(
    id: Category['id'],
    payload: Partial<Category>,
  ): Promise<Category> {
    await this.categoryRepository.update(
      id,
      CategoryMapper.toPersistence(payload),
    );
    const entity = await this.categoryRepository.findOneOrFail({
      where: { id },
    });
    return CategoryMapper.toDomain(entity);
  }
}
