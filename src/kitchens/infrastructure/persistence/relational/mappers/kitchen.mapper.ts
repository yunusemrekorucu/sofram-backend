import { toFileType, toSnapshot } from '../../../../../catalog/file-snapshot';
import { Kitchen } from '../../../../domain/kitchen';
import { KitchenEntity } from '../entities/kitchen.entity';

export class KitchenMapper {
  static toDomain(raw: KitchenEntity): Kitchen {
    return Object.assign(new Kitchen(), {
      id: raw.id,
      ownerId: raw.ownerId,
      name: raw.name,
      description: raw.description,
      coverPhoto: raw.coverPhoto ? toFileType(raw.coverPhoto) : null,
      fullAddress: raw.fullAddress,
      district: raw.district,
      neighborhood: raw.neighborhood,
      latitude: raw.latitude,
      longitude: raw.longitude,
      pickupEnabled: raw.pickupEnabled,
      deliveryEnabled: raw.deliveryEnabled,
      deliveryTiers: raw.deliveryTiers,
      deliveryRadiusKm: raw.deliveryRadiusKm,
      freeDeliveryMinKurus: raw.freeDeliveryMinKurus,
      minOrderKurus: raw.minOrderKurus,
      hours: raw.hours,
      isPaused: raw.isPaused,
      isVerified: raw.isVerified,
      ratingAvg: raw.ratingAvg,
      ratingCount: raw.ratingCount,
      searchText: raw.searchText,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }

  static toPersistence(domain: Partial<Kitchen>): KitchenEntity {
    const { coverPhoto, ownerId, ...fields } = domain;

    return Object.assign(
      new KitchenEntity(),
      fields,
      ownerId === undefined ? {} : { ownerId: Number(ownerId) },
      coverPhoto === undefined
        ? {}
        : { coverPhoto: coverPhoto ? toSnapshot(coverPhoto) : null },
    );
  }
}
