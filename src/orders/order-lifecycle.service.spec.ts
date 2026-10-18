import { ConflictException } from '@nestjs/common';
import { PaymentsService } from '../payments/payments.service';
import { Order } from './domain/order';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anOrder } from './order.fixture';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';

const NOW = new Date('2026-10-12T09:35:00Z');

const build = () => {
  const repository = {
    transition: jest
      .fn()
      .mockImplementation((id: string, _from, patch: Partial<Order>) =>
        Promise.resolve(anOrder({ id, ...patch })),
      ),
    closeAndRestock: jest
      .fn()
      .mockImplementation((id: string, _from, patch: Partial<Order>) =>
        Promise.resolve(anOrder({ id, ...patch })),
      ),
    findOverduePendingIds: jest.fn().mockResolvedValue([]),
  };
  const payments = { refund: jest.fn().mockResolvedValue('refunded') };
  const lifecycle = new OrderLifecycleService(
    repository as unknown as OrderRepository,
    payments as unknown as PaymentsService,
  );
  return { lifecycle, repository, payments };
};

describe('OrderLifecycleService.advance', () => {
  it('should guard the update with the allowed statuses and stamp the time', async () => {
    const { lifecycle, repository, payments } = build();

    const order = await lifecycle.advance(anOrder(), 'accept', {}, NOW);

    expect(repository.transition).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      { status: OrderStatus.accepted, acceptedAt: NOW },
    );
    expect(order.status).toBe(OrderStatus.accepted);
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('should pass extra fields through', async () => {
    const { lifecycle, repository } = build();
    const readyAt = new Date('2026-10-12T10:20:00Z');

    await lifecycle.advance(
      anOrder(),
      'accept',
      { estimatedReadyAt: readyAt },
      NOW,
    );

    expect(repository.transition).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      {
        status: OrderStatus.accepted,
        acceptedAt: NOW,
        estimatedReadyAt: readyAt,
      },
    );
  });

  it('should close, restock and then refund a rejected order', async () => {
    const { lifecycle, repository, payments } = build();

    await lifecycle.advance(
      anOrder(),
      'reject',
      { reason: OrderReason.tooBusy },
      NOW,
    );

    expect(repository.closeAndRestock).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      {
        status: OrderStatus.rejected,
        closedAt: NOW,
        reason: OrderReason.tooBusy,
      },
    );
    expect(payments.refund).toHaveBeenCalledWith('o1');
    expect(repository.closeAndRestock.mock.invocationCallOrder[0]).toBeLessThan(
      payments.refund.mock.invocationCallOrder[0],
    );
  });

  it('should refuse an action the status does not allow, without writing', async () => {
    const { lifecycle, repository } = build();

    await expect(
      lifecycle.advance(anOrder({ status: OrderStatus.accepted }), 'accept'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      lifecycle.advance(anOrder({ status: OrderStatus.ready }), 'dispatch'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it('should report a lost race as orderStatusConflict and not refund', async () => {
    const { lifecycle, repository, payments } = build();
    repository.closeAndRestock.mockResolvedValueOnce(null);

    const error = await lifecycle
      .advance(anOrder(), 'customerCancel', {
        cancelledBy: CancelledBy.customer,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      status: 409,
      error: 'orderStatusConflict',
    });
    expect(payments.refund).not.toHaveBeenCalled();
  });

  it('should dispatch a delivery order from ready', async () => {
    const { lifecycle, repository } = build();

    await lifecycle.advance(
      anOrder({ status: OrderStatus.ready, fulfillment: Fulfillment.delivery }),
      'dispatch',
      {},
      NOW,
    );

    expect(repository.transition).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.ready],
      { status: OrderStatus.onTheWay, onTheWayAt: NOW },
    );
  });
});

describe('OrderLifecycleService.expireOverdue', () => {
  it('should expire each overdue order and refund only the ones it closed', async () => {
    const { lifecycle, repository, payments } = build();
    repository.findOverduePendingIds.mockResolvedValue(['o1', 'o2']);
    repository.closeAndRestock
      .mockResolvedValueOnce(anOrder({ id: 'o1' }))
      .mockResolvedValueOnce(null);

    await expect(lifecycle.expireOverdue({ customerId: 9 }, NOW)).resolves.toBe(
      1,
    );

    expect(repository.findOverduePendingIds).toHaveBeenCalledWith(NOW, {
      customerId: 9,
    });
    expect(repository.closeAndRestock).toHaveBeenCalledWith(
      'o1',
      [OrderStatus.pending],
      {
        status: OrderStatus.expired,
        closedAt: NOW,
        cancelledBy: CancelledBy.system,
        reason: null,
      },
    );
    expect(payments.refund).toHaveBeenCalledTimes(1);
    expect(payments.refund).toHaveBeenCalledWith('o1');
  });
});
