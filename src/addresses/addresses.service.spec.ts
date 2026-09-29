import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DeepPartial } from '../utils/types/deep-partial.type';
import { User } from '../users/domain/user';
import { AddressesService } from './addresses.service';
import { Address } from './domain/address';
import { CreateAddressDto } from './dto/create-address.dto';
import { AddressRepository } from './infrastructure/persistence/address.repository';

type Row = Address & { ownerId: User['id'] };

class InMemoryAddressRepository extends AddressRepository {
  rows: Row[] = [];
  private clock = 0;

  create(data: Omit<Address, 'id' | 'createdAt' | 'updatedAt'>) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++));
    const row = Object.assign(new Address(), data, {
      id: randomUUID(),
      createdAt: at,
      updatedAt: at,
      ownerId: data.user!.id,
    }) as Row;
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findByUserId(userId: User['id']) {
    return Promise.resolve(
      this.rows
        .filter((r) => r.ownerId === userId)
        .sort(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        ),
    );
  }

  countByUserId(userId: User['id']) {
    return Promise.resolve(
      this.rows.filter((r) => r.ownerId === userId).length,
    );
  }

  findOwned(userId: User['id'], id: string) {
    return Promise.resolve(
      this.rows.find((r) => r.id === id && r.ownerId === userId) ?? null,
    );
  }

  update(id: string, payload: DeepPartial<Address>) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, payload);
    return Promise.resolve(row);
  }

  setDefault(userId: User['id'], id: string) {
    for (const r of this.rows.filter((row) => row.ownerId === userId)) {
      r.isDefault = r.id === id;
    }
    return Promise.resolve();
  }

  remove(id: string) {
    this.rows = this.rows.filter((r) => r.id !== id);
    return Promise.resolve();
  }

  removeByUserId(userId: User['id']) {
    this.rows = this.rows.filter((r) => r.ownerId !== userId);
    return Promise.resolve();
  }
}

const dto = (title: string, extra: Partial<CreateAddressDto> = {}) =>
  ({
    title,
    fullAddress: 'Caferağa Mh. Moda Cd. No:1',
    district: 'Kadıköy',
    neighborhood: 'Caferağa',
    latitude: 40.98,
    longitude: 29.02,
    ...extra,
  }) as CreateAddressDto;

describe('AddressesService', () => {
  let repo: InMemoryAddressRepository;
  let service: AddressesService;
  const ME = 1;
  const SOMEONE_ELSE = 2;

  beforeEach(() => {
    repo = new InMemoryAddressRepository();
    service = new AddressesService(repo);
  });

  it('should make the first address the default', async () => {
    const first = await service.create(ME, dto('Ev'));
    expect(first.isDefault).toBe(true);
  });

  it('should keep the current default unless the new one asks for it', async () => {
    const home = await service.create(ME, dto('Ev'));
    const work = await service.create(ME, dto('İş'));
    expect(work.isDefault).toBe(false);

    const gym = await service.create(ME, dto('Spor', { isDefault: true }));

    const list = await service.findAllForUser(ME);
    expect(list.map((a) => a.id)).toEqual([gym.id, work.id, home.id]);
    expect(list.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('should switch the default on update', async () => {
    await service.create(ME, dto('Ev'));
    const work = await service.create(ME, dto('İş'));

    const updated = await service.update(ME, work.id, {
      isDefault: true,
      floor: '3',
    });

    expect(updated).toMatchObject({ isDefault: true, floor: '3' });
    expect((await service.findAllForUser(ME))[0].id).toBe(work.id);
  });

  it('should promote the newest remaining address when the default is removed', async () => {
    const home = await service.create(ME, dto('Ev'));
    await service.create(ME, dto('İş'));
    const gym = await service.create(ME, dto('Spor'));

    await service.remove(ME, home.id);

    const [first] = await service.findAllForUser(ME);
    expect(first).toMatchObject({ id: gym.id, isDefault: true });
  });

  it("should answer 404 for someone else's address", async () => {
    const theirs = await service.create(SOMEONE_ELSE, dto('Ev'));

    await expect(
      service.update(ME, theirs.id, { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(ME, theirs.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.findAllForUser(ME)).toEqual([]);
  });

  it("should delete every address of a user and nobody else's", async () => {
    await service.create(ME, dto('Ev'));
    await service.create(ME, dto('İş'));
    const theirs = await service.create(SOMEONE_ELSE, dto('Ev'));

    await service.removeAllForUser(ME);

    expect(await service.findAllForUser(ME)).toEqual([]);
    expect(await service.findAllForUser(SOMEONE_ELSE)).toEqual([theirs]);
  });
});
