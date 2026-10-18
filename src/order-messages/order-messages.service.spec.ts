import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { KitchensService } from '../kitchens/kitchens.service';
import { Order } from '../orders/domain/order';
import { OrderRepository } from '../orders/infrastructure/persistence/order.repository';
import { anOrder } from '../orders/order.fixture';
import { OrderStatus } from '../orders/order.enums';
import { MessageSide } from '../trust/trust.enums';
import { OrderMessageRepository } from './infrastructure/persistence/order-message.repository';
import { MESSAGE_PAGE, OrderMessagesService } from './order-messages.service';

const NOW = new Date('2026-10-13T10:00:00Z');
const message = {
  id: 'm1',
  orderId: 'o1',
  senderId: 7,
  senderRole: MessageSide.cook,
  body: 'Yoldayım',
  createdAt: new Date('2026-10-13T09:59:00Z'),
};

const build = (
  order: Order | null = anOrder({ status: OrderStatus.ready }),
) => {
  const messages = {
    create: jest
      .fn()
      .mockImplementation((data) =>
        Promise.resolve({ ...data, id: 'm2', createdAt: NOW }),
      ),
    list: jest.fn().mockResolvedValue([message]),
  };
  const orders = {
    findForCustomer: jest.fn().mockResolvedValue(order),
    findForKitchen: jest.fn().mockResolvedValue(order),
    markRead: jest.fn().mockResolvedValue(undefined),
  };
  const kitchens = {
    findMine: jest.fn().mockResolvedValue({ id: 'k1', ownerId: 7 }),
  };
  const config = {
    getOrThrow: (key: string) => ({ 'trust.messagingWindowHours': 24 })[key],
  };

  const service = new OrderMessagesService(
    messages as unknown as OrderMessageRepository,
    orders as unknown as OrderRepository,
    kitchens as unknown as KitchensService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return { service, messages, orders, kitchens };
};

describe('OrderMessagesService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should mark the customer’s side read, then return the newer messages', async () => {
    const { service, messages, orders } = build();

    const view = await service.readAsCustomer(
      9,
      'o1',
      '2026-10-13T09:00:00.000Z',
    );

    expect(orders.markRead).toHaveBeenCalledWith(
      'o1',
      'customerLastReadAt',
      NOW,
    );
    expect(messages.list).toHaveBeenCalledWith(
      'o1',
      new Date('2026-10-13T09:00:00.000Z'),
      MESSAGE_PAGE,
    );
    expect(view).toEqual({
      data: [
        {
          id: 'm1',
          senderRole: 'cook',
          body: 'Yoldayım',
          createdAt: message.createdAt,
        },
      ],
      canMessage: true,
    });
    expect(view.data[0]).not.toHaveProperty('senderId');
  });

  it('should read from the start without `after` and mark the cook’s side', async () => {
    const { service, messages, orders, kitchens } = build();

    await service.readAsCook(7, 'o1', undefined);

    expect(kitchens.findMine).toHaveBeenCalledWith(7);
    expect(orders.findForKitchen).toHaveBeenCalledWith('k1', 'o1');
    expect(orders.markRead).toHaveBeenCalledWith('o1', 'cookLastReadAt', NOW);
    expect(messages.list).toHaveBeenCalledWith('o1', null, MESSAGE_PAGE);
  });

  it('should send with the sender’s side', async () => {
    const { service, messages } = build();

    await service.sendAsCustomer(9, 'o1', 'Kapıdayım');
    await service.sendAsCook(7, 'o1', 'Geliyorum');

    expect(messages.create).toHaveBeenNthCalledWith(1, {
      orderId: 'o1',
      senderId: 9,
      senderRole: MessageSide.customer,
      body: 'Kapıdayım',
    });
    expect(messages.create).toHaveBeenNthCalledWith(2, {
      orderId: 'o1',
      senderId: 7,
      senderRole: MessageSide.cook,
      body: 'Geliyorum',
    });
  });

  it('should go read-only 24 hours after the order closed', async () => {
    const closed = anOrder({
      status: OrderStatus.completed,
      completedAt: new Date('2026-10-12T09:59:00Z'),
    });
    const { service, messages } = build(closed);

    const error = await service
      .sendAsCustomer(9, 'o1', 'Merhaba')
      .catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      status: 409,
      error: 'messagingClosed',
    });
    expect(messages.create).not.toHaveBeenCalled();
    await expect(
      service.readAsCustomer(9, 'o1', undefined),
    ).resolves.toMatchObject({ canMessage: false });
  });

  it('should 404 anyone outside the order', async () => {
    const { service, messages } = build(null);

    await expect(
      service.readAsCustomer(10, 'o1', undefined),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.sendAsCook(8, 'o1', 'Hey')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(messages.list).not.toHaveBeenCalled();
  });
});
