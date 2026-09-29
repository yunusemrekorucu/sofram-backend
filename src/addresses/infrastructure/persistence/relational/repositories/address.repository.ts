import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressEntity } from '../entities/address.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';
import { Address } from '../../../../domain/address';
import { AddressRepository } from '../../address.repository';
import { AddressMapper } from '../mappers/address.mapper';
import { User } from '../../../../../users/domain/user';

@Injectable()
export class AddressRelationalRepository implements AddressRepository {
  constructor(
    @InjectRepository(AddressEntity)
    private readonly addressRepository: Repository<AddressEntity>,
  ) {}

  async create(data: Address): Promise<Address> {
    const persistenceModel = AddressMapper.toPersistence(data);
    const newEntity = await this.addressRepository.save(
      this.addressRepository.create(persistenceModel),
    );
    return AddressMapper.toDomain(newEntity);
  }

  async findByUserId(userId: User['id']): Promise<Address[]> {
    const entities = await this.addressRepository.find({
      where: { user: { id: Number(userId) } },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });

    return entities.map((entity) => AddressMapper.toDomain(entity));
  }

  countByUserId(userId: User['id']): Promise<number> {
    return this.addressRepository.count({
      where: { user: { id: Number(userId) } },
    });
  }

  async findOwned(
    userId: User['id'],
    id: Address['id'],
  ): Promise<NullableType<Address>> {
    const entity = await this.addressRepository.findOne({
      where: { id, user: { id: Number(userId) } },
    });

    return entity ? AddressMapper.toDomain(entity) : null;
  }

  async setDefault(userId: User['id'], id: Address['id']): Promise<void> {
    await this.addressRepository.manager.transaction(async (manager) => {
      // Quoted: Postgres folds unquoted identifiers to lower case.
      await manager
        .createQueryBuilder()
        .update(AddressEntity)
        .set({ isDefault: false })
        .where('"userId" = :userId', { userId })
        .execute();

      await manager
        .createQueryBuilder()
        .update(AddressEntity)
        .set({ isDefault: true })
        .where('id = :id AND "userId" = :userId', { id, userId })
        .execute();
    });
  }

  async update(id: Address['id'], payload: Partial<Address>): Promise<Address> {
    const entity = await this.addressRepository.findOne({
      where: { id },
    });

    if (!entity) {
      throw new Error('Record not found');
    }

    const updatedEntity = await this.addressRepository.save(
      this.addressRepository.create(
        AddressMapper.toPersistence({
          ...AddressMapper.toDomain(entity),
          ...payload,
        }),
      ),
    );

    return AddressMapper.toDomain(updatedEntity);
  }

  async remove(id: Address['id']): Promise<void> {
    await this.addressRepository.delete(id);
  }

  async removeByUserId(userId: User['id']): Promise<void> {
    await this.addressRepository.delete({ user: { id: Number(userId) } });
  }
}
