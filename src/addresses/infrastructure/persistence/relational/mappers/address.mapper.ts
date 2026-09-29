import { Address } from '../../../../domain/address';
import { UserMapper } from '../../../../../users/infrastructure/persistence/relational/mappers/user.mapper';

import { AddressEntity } from '../entities/address.entity';

export class AddressMapper {
  static toDomain(raw: AddressEntity): Address {
    const domainEntity = new Address();
    if (raw.user) {
      domainEntity.user = UserMapper.toDomain(raw.user);
    }

    domainEntity.isDefault = raw.isDefault;

    domainEntity.longitude = raw.longitude;

    domainEntity.latitude = raw.latitude;

    domainEntity.directions = raw.directions;

    domainEntity.apartmentNo = raw.apartmentNo;

    domainEntity.floor = raw.floor;

    domainEntity.buildingNo = raw.buildingNo;

    domainEntity.neighborhood = raw.neighborhood;

    domainEntity.district = raw.district;

    domainEntity.fullAddress = raw.fullAddress;

    domainEntity.title = raw.title;

    domainEntity.id = raw.id;
    domainEntity.createdAt = raw.createdAt;
    domainEntity.updatedAt = raw.updatedAt;

    return domainEntity;
  }

  static toPersistence(domainEntity: Address): AddressEntity {
    const persistenceEntity = new AddressEntity();
    if (domainEntity.user) {
      persistenceEntity.user = UserMapper.toPersistence(domainEntity.user);
    }

    persistenceEntity.isDefault = domainEntity.isDefault;

    persistenceEntity.longitude = domainEntity.longitude;

    persistenceEntity.latitude = domainEntity.latitude;

    persistenceEntity.directions = domainEntity.directions;

    persistenceEntity.apartmentNo = domainEntity.apartmentNo;

    persistenceEntity.floor = domainEntity.floor;

    persistenceEntity.buildingNo = domainEntity.buildingNo;

    persistenceEntity.neighborhood = domainEntity.neighborhood;

    persistenceEntity.district = domainEntity.district;

    persistenceEntity.fullAddress = domainEntity.fullAddress;

    persistenceEntity.title = domainEntity.title;

    if (domainEntity.id) {
      persistenceEntity.id = domainEntity.id;
    }
    persistenceEntity.createdAt = domainEntity.createdAt;
    persistenceEntity.updatedAt = domainEntity.updatedAt;

    return persistenceEntity;
  }
}
