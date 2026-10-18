import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Kitchen } from '../../../../../kitchens/domain/kitchen';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Product } from '../../../../domain/product';
import { ProductRepository } from '../../product.repository';
import { ProductEntity } from '../entities/product.entity';
import { ProductMapper } from '../mappers/product.mapper';

@Injectable()
export class ProductRelationalRepository implements ProductRepository {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}

  async create(
    data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Product> {
    const saved = await this.productRepository.save(
      this.productRepository.create(ProductMapper.toPersistence(data)),
    );
    return this.reload(saved.id);
  }

  async findByKitchenId(kitchenId: Kitchen['id']): Promise<Product[]> {
    const entities = await this.productRepository.find({
      where: { kitchenId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((entity) => ProductMapper.toDomain(entity));
  }

  async findByIds(ids: Product['id'][]): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.productRepository.find({
      where: { id: In(ids) },
    });
    return entities.map((entity) => ProductMapper.toDomain(entity));
  }

  async findOwned(
    kitchenId: Kitchen['id'],
    id: Product['id'],
  ): Promise<NullableType<Product>> {
    const entity = await this.productRepository.findOne({
      where: { id, kitchenId },
    });
    return entity ? ProductMapper.toDomain(entity) : null;
  }

  async update(id: Product['id'], payload: Partial<Product>): Promise<Product> {
    await this.productRepository.save(
      this.productRepository.create({
        ...ProductMapper.toPersistence(payload),
        id,
      }),
    );
    return this.reload(id);
  }

  async softDelete(id: Product['id']): Promise<void> {
    await this.productRepository.softDelete(id);
  }

  async softDeleteByKitchenId(kitchenId: Kitchen['id']): Promise<void> {
    await this.productRepository.softDelete({ kitchenId });
  }

  /** save() does not reload the eager category; read the row back. */
  private async reload(id: Product['id']): Promise<Product> {
    const entity = await this.productRepository.findOneOrFail({
      where: { id },
    });
    return ProductMapper.toDomain(entity);
  }
}
