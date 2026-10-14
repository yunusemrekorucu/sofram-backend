import { Injectable } from '@nestjs/common';
import { User } from '../users/domain/user';
import { orNotFound } from '../utils/or-not-found';
import { Address } from './domain/address';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressRepository } from './infrastructure/persistence/address.repository';

@Injectable()
export class AddressesService {
  constructor(private readonly addressRepository: AddressRepository) {}

  findAllForUser(userId: User['id']): Promise<Address[]> {
    return this.addressRepository.findByUserId(userId);
  }

  async create(userId: User['id'], dto: CreateAddressDto): Promise<Address> {
    const isFirst = (await this.addressRepository.countByUserId(userId)) === 0;
    const { isDefault, ...fields } = dto;

    const created = await this.addressRepository.create({
      ...fields,
      user: { id: userId } as User,
      isDefault: false,
    });

    if (isFirst || isDefault) {
      await this.addressRepository.setDefault(userId, created.id);
    }

    return this.findOwned(userId, created.id);
  }

  async update(
    userId: User['id'],
    id: Address['id'],
    dto: UpdateAddressDto,
  ): Promise<Address> {
    await this.findOwned(userId, id);
    // isDefault: false is ignored — the default moves by choosing another one.
    const { isDefault, ...fields } = dto;

    await this.addressRepository.update(id, fields);

    if (isDefault) {
      await this.addressRepository.setDefault(userId, id);
    }

    return this.findOwned(userId, id);
  }

  async remove(userId: User['id'], id: Address['id']): Promise<void> {
    const address = await this.findOwned(userId, id);

    await this.addressRepository.remove(id);

    if (address.isDefault) {
      const [newest] = await this.addressRepository.findByUserId(userId);

      if (newest) {
        await this.addressRepository.setDefault(userId, newest.id);
      }
    }
  }

  /** Account deletion (KVKK): addresses carry GPS, so they are hard-deleted. */
  removeAllForUser(userId: User['id']): Promise<void> {
    return this.addressRepository.removeByUserId(userId);
  }

  /** The caller's address, or 404 (also for someone else's). */
  findOwned(userId: User['id'], id: Address['id']): Promise<Address> {
    return orNotFound(this.addressRepository.findOwned(userId, id));
  }
}
