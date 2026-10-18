import { Repository } from 'typeorm';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewReportEntity } from '../entities/review-report.entity';
import { ReviewRelationalRepository } from './review.repository';

function build(found: unknown) {
  const fake = {
    findOne: jest.fn().mockResolvedValue(found),
    query: jest.fn().mockResolvedValue([]),
    softDelete: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(),
  };
  const typeorm = {
    manager: {
      transaction: jest.fn((cb: (m: typeof fake) => Promise<void>) => cb(fake)),
    },
  };
  const repository = new ReviewRelationalRepository(
    typeorm as unknown as Repository<ReviewEntity>,
    {} as unknown as Repository<ReviewReportEntity>,
  );

  return { repository, fake };
}

describe('ReviewRelationalRepository.softDelete', () => {
  it('should do nothing when a concurrent request already deleted the review', async () => {
    const { repository, fake } = build(null);

    await expect(repository.softDelete('r1')).resolves.toBeUndefined();

    expect(fake.query).not.toHaveBeenCalled();
    expect(fake.softDelete).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('should lock the kitchen, soft-deletes and recomputes when found', async () => {
    const { repository, fake } = build({ id: 'r1', kitchenId: 'k1' });
    const spy = jest
      .spyOn(
        repository as unknown as { recompute: () => Promise<void> },
        'recompute',
      )
      .mockResolvedValue(undefined);

    await repository.softDelete('r1');

    expect(fake.query).toHaveBeenCalledTimes(1);
    expect(fake.softDelete).toHaveBeenCalledWith(ReviewEntity, { id: 'r1' });
    expect(spy).toHaveBeenCalledWith(fake, 'k1');
  });
});
