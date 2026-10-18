import { Repository } from 'typeorm';
import { KitchenEntity } from '../entities/kitchen.entity';
import { KitchenRelationalRepository } from './kitchen.repository';

describe('KitchenRelationalRepository.update', () => {
  it('should never persist a stale rating copy', async () => {
    const saved: Partial<KitchenEntity>[] = [];
    const typeorm = {
      create: jest.fn((data: Partial<KitchenEntity>) => data),
      save: jest.fn((data: Partial<KitchenEntity>) => {
        saved.push(data);
        return Promise.resolve(data);
      }),
      findOneOrFail: jest.fn().mockResolvedValue({
        id: 'k1',
        ownerId: 7,
        ratingAvg: 4.5,
        ratingCount: 2,
      }),
    };
    const repository = new KitchenRelationalRepository(
      typeorm as unknown as Repository<KitchenEntity>,
    );

    await repository.update('k1', {
      description: 'Yeni',
      ratingAvg: 1,
      ratingCount: 99,
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'k1', description: 'Yeni' });
    expect(saved[0].ratingAvg).toBeUndefined();
    expect(saved[0].ratingCount).toBeUndefined();
  });
});
