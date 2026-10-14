import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { FileType } from '../files/domain/file';
import { FilesService } from '../files/files.service';
import { Kitchen } from './domain/kitchen';
import { CreateKitchenDto } from './dto/create-kitchen.dto';
import { KitchenRepository } from './infrastructure/persistence/kitchen.repository';
import { KitchensService } from './kitchens.service';

const HOME = Object.assign(new Address(), {
  id: 'a1',
  title: 'Ev',
  fullAddress: 'Caferağa Mh. Moda Cd. No:1',
  district: 'Kadıköy',
  neighborhood: 'Caferağa',
  latitude: 40.9862,
  longitude: 29.0254,
});

const WORK = Object.assign(new Address(), {
  ...HOME,
  id: 'a2',
  district: 'Beşiktaş',
  neighborhood: 'Sinanpaşa',
  latitude: 41.0428,
  longitude: 29.0075,
});

const dto = (overrides: Partial<CreateKitchenDto> = {}): CreateKitchenDto => ({
  name: 'Ayşe Teyze Mutfağı',
  addressId: 'a1',
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 0 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  ...overrides,
});

const build = () => {
  let stored: Kitchen | null = null;
  const repository = {
    create: jest.fn().mockImplementation((data) => {
      stored = Object.assign(new Kitchen(), data, { id: 'k1' });
      return Promise.resolve(stored);
    }),
    findByOwnerId: jest.fn().mockImplementation(() => Promise.resolve(stored)),
    update: jest.fn().mockImplementation((id, data) => {
      stored = Object.assign(new Kitchen(), data, { id });
      return Promise.resolve(stored);
    }),
    softDeleteByOwnerId: jest.fn(),
  };
  const addresses = {
    findOwned: jest
      .fn()
      .mockImplementation((_, id) =>
        Promise.resolve(id === 'a2' ? WORK : HOME),
      ),
  };
  const files = { findByIds: jest.fn().mockResolvedValue([]) };
  const service = new KitchensService(
    repository as unknown as KitchenRepository,
    addresses as unknown as AddressesService,
    files as unknown as FilesService,
  );
  return { service, repository, addresses, files };
};

describe('KitchensService.create', () => {
  it('should copy the address and derive radius and search text', async () => {
    const { service, addresses } = build();

    const kitchen = await service.create(7, dto());

    expect(addresses.findOwned).toHaveBeenCalledWith(7, 'a1');
    expect(kitchen).toMatchObject({
      ownerId: 7,
      fullAddress: HOME.fullAddress,
      district: 'Kadıköy',
      latitude: 40.9862,
      longitude: 29.0254,
      description: null,
      coverPhoto: null,
      freeDeliveryMinKurus: null,
      isPaused: false,
      isVerified: false,
      deliveryRadiusKm: 5,
      searchText: 'ayse teyze mutfagi kadikoy caferaga',
    });
  });

  it('should refuse a second kitchen', async () => {
    const { service } = build();
    await service.create(7, dto());

    await expect(service.create(7, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('should enforce the cross-field rules', async () => {
    const { service } = build();

    await expect(
      service.create(7, dto({ pickupEnabled: false, deliveryEnabled: false })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('should snapshot an existing cover photo and reject a missing one', async () => {
    const { service, files } = build();
    const cover = Object.assign(new FileType(), { id: 'f1', path: '/f1.png' });

    await expect(
      service.create(7, dto({ coverPhotoId: 'missing' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    files.findByIds.mockResolvedValue([cover]);
    const kitchen = await service.create(7, dto({ coverPhotoId: 'f1' }));
    expect(kitchen.coverPhoto).toEqual(cover);
  });
});

describe('KitchensService.update', () => {
  it('should merge changes and recompute derived fields', async () => {
    const { service } = build();
    await service.create(7, dto());

    const kitchen = await service.update(7, {
      isPaused: true,
      deliveryEnabled: false,
    });

    expect(kitchen).toMatchObject({
      name: 'Ayşe Teyze Mutfağı',
      isPaused: true,
      deliveryEnabled: false,
      deliveryRadiusKm: null,
      deliveryTiers: dto().deliveryTiers,
    });
  });

  it('should re-copy the address when addressId changes', async () => {
    const { service, addresses } = build();
    await service.create(7, dto());

    const kitchen = await service.update(7, { addressId: 'a2' });

    expect(addresses.findOwned).toHaveBeenLastCalledWith(7, 'a2');
    expect(kitchen).toMatchObject({
      district: 'Beşiktaş',
      latitude: 41.0428,
      searchText: 'ayse teyze mutfagi besiktas sinanpasa',
    });
  });

  it('should 404 without a kitchen', async () => {
    const { service } = build();

    await expect(service.update(7, { isPaused: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
