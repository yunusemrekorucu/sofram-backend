import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from '../../../../../users/domain/user';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Kitchen } from '../../../../domain/kitchen';
import { KitchenRepository } from '../../kitchen.repository';
import { KitchenEntity } from '../entities/kitchen.entity';
import { KitchenMapper } from '../mappers/kitchen.mapper';

@Injectable()
export class KitchenRelationalRepository implements KitchenRepository {
  constructor(
    @InjectRepository(KitchenEntity)
    private readonly kitchenRepository: Repository<KitchenEntity>,
  ) {}

  async create(
    data: Omit<
      Kitchen,
      'id' | 'createdAt' | 'updatedAt' | 'ratingAvg' | 'ratingCount'
    >,
  ): Promise<Kitchen> {
    const entity = await this.kitchenRepository.save(
      this.kitchenRepository.create(KitchenMapper.toPersistence(data)),
    );
    return KitchenMapper.toDomain(entity);
  }

  async findByOwnerId(ownerId: User['id']): Promise<NullableType<Kitchen>> {
    const entity = await this.kitchenRepository.findOne({
      where: { ownerId: Number(ownerId) },
    });
    return entity ? KitchenMapper.toDomain(entity) : null;
  }

  async findById(id: Kitchen['id']): Promise<NullableType<Kitchen>> {
    const entity = await this.kitchenRepository.findOne({ where: { id } });
    return entity ? KitchenMapper.toDomain(entity) : null;
  }

  async update(id: Kitchen['id'], payload: Partial<Kitchen>): Promise<Kitchen> {
    await this.kitchenRepository.save(
      this.kitchenRepository.create({
        ...KitchenMapper.toPersistence(payload),
        // The review transactions own these; a stale copy must not overwrite them.
        ratingAvg: undefined,
        ratingCount: undefined,
        id,
      }),
    );
    const entity = await this.kitchenRepository.findOneOrFail({
      where: { id },
    });
    return KitchenMapper.toDomain(entity);
  }

  /**
   * The kitchen row is a copy of an address-book entry (full address and exact
   * coordinates), which account deletion hard-deletes for KVKK. A plain soft
   * delete would keep that copy, so one UPDATE scrubs it and sets deletedAt.
   */
  async anonymizeAndSoftDeleteByOwnerId(ownerId: User['id']): Promise<void> {
    await this.kitchenRepository.update(
      { ownerId: Number(ownerId), deletedAt: IsNull() },
      {
        name: '',
        description: null,
        coverPhoto: null,
        fullAddress: '',
        district: '',
        neighborhood: '',
        latitude: 0,
        longitude: 0,
        searchText: '',
        isPaused: true,
        deletedAt: new Date(),
      },
    );
  }
}
