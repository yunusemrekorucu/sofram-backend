import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SaleType } from '../catalog/catalog.enums';
import { AllConfigType } from '../config/config.type';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from './domain/order';
import { OrderRepository } from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderTrustService } from './order-trust.service';
import { anItem, anOrder } from './order.fixture';
import {
  CancelledBy,
  CookTab,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from './order.enums';
import { CookOrdersService } from './cook-orders.service';

// A Sunday, 13:00 in Istanbul.
const NOW = new Date('2026-10-18T10:00:00Z');

const build = (order: Order = anOrder()) => {
  const repository = {
    findForKitchen: jest.fn().mockResolvedValue(order),
    listForKitchen: jest.fn().mockResolvedValue([order]),
    countByStatus: jest.fn().mockResolvedValue({
      [OrderStatus.pending]: 2,
      [OrderStatus.accepted]: 1,
      [OrderStatus.preparing]: 1,
      [OrderStatus.onTheWay]: 1,
    }),
    completedTotals: jest
      .fn()
      .mockResolvedValueOnce({ orders: 3, revenueKurus: 42000 })
      .mockResolvedValueOnce({ orders: 9, revenueKurus: 126000 }),
    hasCompleted: jest.fn().mockResolvedValue(true),
  };
  const lifecycle = {
    expireOverdue: jest.fn().mockResolvedValue(0),
    advance: jest
      .fn()
      .mockImplementation((current: Order, _action, patch) =>
        Promise.resolve({ ...current, ...patch }),
      ),
  };
  const kitchens = {
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const trust = {
    forCook: jest.fn().mockResolvedValue({
      review: null,
      issue: null,
      unreadMessages: 2,
      canMessage: true,
    }),
    cookUnread: jest.fn().mockResolvedValue(new Map([['o1', 4]])),
    cookSummary: jest.fn().mockResolvedValue({
      rating: { avg: 4.8, count: 12 },
      unrepliedReviews: 3,
      unreadMessages: 5,
    }),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'orders.deliveryBufferMinutes': 15 })[key],
  };

  const service = new CookOrdersService(
    repository as unknown as OrderRepository,
    lifecycle as unknown as OrderLifecycleService,
    kitchens as unknown as KitchensService,
    trust as unknown as OrderTrustService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, repository, lifecycle, kitchens, trust };
};

describe('CookOrdersService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should 404 a user without a kitchen', async () => {
    const { service, kitchens } = build();
    kitchens.findMine.mockRejectedValue(new NotFoundException());

    await expect(
      service.list(7, { tab: CookTab.new, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should expire overdue orders before listing a tab', async () => {
    const { service, repository, lifecycle } = build();

    const page = await service.list(7, {
      tab: CookTab.done,
      page: 2,
      limit: 10,
    });

    expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ kitchenId: 'k1' });
    expect(repository.listForKitchen).toHaveBeenCalledWith(
      'k1',
      CookTab.done,
      new Date('2026-10-17T21:00:00Z'),
      { offset: 10, limit: 10 },
    );
    expect(page.data[0]).toMatchObject({ id: 'o1', customerName: 'Deniz İ.' });
  });

  it('should 404 another kitchen’s order', async () => {
    const { service, repository } = build();
    repository.findForKitchen.mockResolvedValue(null);

    await expect(service.detail(7, 'o1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('should sum the tabs, today, the week and the first completion', async () => {
    const { service, repository } = build();

    await expect(service.summary(7)).resolves.toEqual({
      counts: { new: 2, preparing: 2, ready: 1 },
      today: { orders: 3, revenueKurus: 42000 },
      week: { orders: 9, revenueKurus: 126000 },
      hasEverCompleted: true,
      rating: { avg: 4.8, count: 12 },
      unrepliedReviews: 3,
      unreadMessages: 5,
    });
    expect(repository.completedTotals).toHaveBeenNthCalledWith(
      1,
      'k1',
      new Date('2026-10-17T21:00:00Z'),
    );
    expect(repository.completedTotals).toHaveBeenNthCalledWith(
      2,
      'k1',
      new Date('2026-10-11T21:00:00Z'),
    );
  });

  it('should promise the order for the longest prep plus the delivery buffer', async () => {
    const { service, lifecycle } = build(
      anOrder({
        fulfillment: Fulfillment.delivery,
        items: [
          anItem({ prepMinutes: 20 }),
          anItem({ saleType: SaleType.dailyPortion, prepMinutes: null }),
        ],
      }),
    );

    await service.accept(7, 'o1');

    expect(lifecycle.advance).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o1' }),
      'accept',
      { estimatedReadyAt: new Date('2026-10-18T10:35:00Z') },
      NOW,
    );
  });

  it('should reject and cancel with the cook’s reason', async () => {
    const { service, lifecycle } = build();

    await service.reject(7, 'o1', OrderReason.tooBusy);
    await service.cancel(7, 'o1', OrderReason.outOfIngredients);

    expect(lifecycle.advance).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'reject',
      { reason: OrderReason.tooBusy },
    );
    expect(lifecycle.advance).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'cookCancel',
      { cancelledBy: CancelledBy.cook, reason: OrderReason.outOfIngredients },
    );
  });

  describe('complete', () => {
    const ready = anOrder({ status: OrderStatus.ready, pickupCode: '0427' });

    it('should require the pickup code', async () => {
      const { service, lifecycle } = build(ready);

      const error = await service.complete(7, 'o1', {}).catch((e) => e);

      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { pickupCode: 'required' },
      });
      expect(lifecycle.advance).not.toHaveBeenCalled();
    });

    it('should refuse a wrong pickup code', async () => {
      const { service } = build(ready);

      const error = await service
        .complete(7, 'o1', { pickupCode: '1234' })
        .catch((e) => e);

      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { pickupCode: 'invalid' },
      });
    });

    it('should complete with the right code', async () => {
      const { service, lifecycle } = build(ready);

      await service.complete(7, 'o1', { pickupCode: '0427' });

      expect(lifecycle.advance).toHaveBeenCalledWith(ready, 'complete');
    });

    it('should not ask for a code on a delivery order', async () => {
      const { service, lifecycle } = build(
        anOrder({
          status: OrderStatus.onTheWay,
          fulfillment: Fulfillment.delivery,
          pickupCode: null,
        }),
      );

      await service.complete(7, 'o1', {});

      expect(lifecycle.advance).toHaveBeenCalled();
    });

    it('should report the wrong status before checking the code', async () => {
      const { service } = build(anOrder({ status: OrderStatus.preparing }));

      await expect(service.complete(7, 'o1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});

describe('CookOrdersService trust fields', () => {
  it('should add the unread count to every card', async () => {
    const { service, trust } = build();

    const page = await service.list(7, {
      tab: CookTab.ready,
      page: 1,
      limit: 20,
    });

    expect(trust.cookUnread).toHaveBeenCalledWith([anOrder()]);
    expect(page.data[0].unreadMessages).toBe(4);
  });

  it('should add review, issue and chat state to the detail and every step', async () => {
    const { service, trust } = build(anOrder({ status: OrderStatus.accepted }));

    await expect(service.detail(7, 'o1')).resolves.toMatchObject({
      review: null,
      issue: null,
      unreadMessages: 2,
      canMessage: true,
    });
    await expect(service.start(7, 'o1')).resolves.toMatchObject({
      unreadMessages: 2,
    });
    expect(trust.forCook).toHaveBeenCalledTimes(2);
  });
});
