import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { FavoritesService } from './favorites.service';
import { FavoriteRepository } from './infrastructure/persistence/favorite.repository';

const kitchen = Object.assign(new Kitchen(), {
  id: 'k1',
  name: 'Ayşe Teyze Mutfağı',
  district: 'Kadıköy',
  neighborhood: 'Caferağa',
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: false,
  deliveryTiers: [],
  hours: [],
  isPaused: true,
  isVerified: false,
  coverPhoto: null,
  freeDeliveryMinKurus: null,
  ratingAvg: null,
  ratingCount: 0,
});

const build = () => {
  const favorites = {
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    listKitchens: jest.fn().mockResolvedValue([kitchen]),
    favoriteKitchenIds: jest.fn().mockResolvedValue(['k1']),
  };
  const kitchens = { findById: jest.fn().mockResolvedValue(kitchen) };
  const config = {
    getOrThrow: (key: string) =>
      ({ 'discovery.pickupRadiusKm': 5, 'discovery.coordPrecision': 3 })[key],
  };

  const service = new FavoritesService(
    favorites as unknown as FavoriteRepository,
    kitchens as unknown as KitchensService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, favorites, kitchens };
};

describe('FavoritesService', () => {
  it('should add and remove a live kitchen, paused or not', async () => {
    const { service, favorites } = build();

    await service.add(9, 'k1');
    await service.remove(9, 'k1');

    expect(favorites.add).toHaveBeenCalledWith(9, 'k1');
    expect(favorites.remove).toHaveBeenCalledWith(9, 'k1');
  });

  it('should 404 a kitchen that is gone', async () => {
    const { service, kitchens, favorites } = build();
    kitchens.findById.mockResolvedValue(null);

    await expect(service.add(9, 'k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(9, 'k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(favorites.add).not.toHaveBeenCalled();
  });

  it('should list favorites as discovery cards measured from the given point', async () => {
    const { service, favorites } = build();

    const page = await service.list(9, {
      lat: 40.988,
      lng: 29.022,
      page: 2,
      limit: 1,
    });

    expect(favorites.listKitchens).toHaveBeenCalledWith(9, {
      offset: 1,
      limit: 1,
    });
    expect(page).toEqual({
      data: [
        expect.objectContaining({
          id: 'k1',
          distanceKm: 0,
          isPaused: true,
          isFavorite: true,
          ratingAvg: null,
          ratingCount: 0,
          latitude: 40.988,
        }),
      ],
      hasNextPage: true,
    });
  });

  it('should answer which kitchens are favorites as a set', async () => {
    const { service } = build();

    await expect(service.favoriteKitchenIds(9, ['k1', 'k2'])).resolves.toEqual(
      new Set(['k1']),
    );
  });
});
