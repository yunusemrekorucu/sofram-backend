import { Logger } from '@nestjs/common';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersExpiryTask } from './orders-expiry.task';

const NOW = new Date('2026-10-18T10:00:00Z');

const build = () => {
  const lifecycle = { expireOverdue: jest.fn().mockResolvedValue(2) };
  const repository = {
    deleteRequestsBefore: jest.fn().mockResolvedValue(undefined),
  };
  const task = new OrdersExpiryTask(
    lifecycle as unknown as OrderLifecycleService,
    repository as unknown as OrderRepository,
  );
  return { task, lifecycle, repository };
};

describe('OrdersExpiryTask', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('should expire every overdue order and forget day-old request keys', async () => {
    const { task, lifecycle, repository } = build();

    await task.sweep(NOW);

    expect(lifecycle.expireOverdue).toHaveBeenCalledWith({}, NOW);
    expect(repository.deleteRequestsBefore).toHaveBeenCalledWith(
      new Date('2026-10-17T10:00:00Z'),
    );
  });

  it('should log a failed pass and keep running', async () => {
    const { task, lifecycle, repository } = build();
    lifecycle.expireOverdue.mockRejectedValueOnce(new Error('db down'));

    await expect(task.sweep(NOW)).resolves.toBeUndefined();
    expect(repository.deleteRequestsBefore).not.toHaveBeenCalled();

    await task.sweep(NOW);
    expect(repository.deleteRequestsBefore).toHaveBeenCalledTimes(1);
  });

  it('should skip a tick while the previous pass is still running', async () => {
    const { task, lifecycle } = build();
    let finish: (count: number) => void = () => undefined;
    lifecycle.expireOverdue.mockImplementationOnce(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );

    const first = task.sweep(NOW);
    await task.sweep(NOW);
    finish(0);
    await first;

    expect(lifecycle.expireOverdue).toHaveBeenCalledTimes(1);
  });
});
