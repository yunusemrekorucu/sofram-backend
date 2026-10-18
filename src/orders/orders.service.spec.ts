import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { SaleType } from '../catalog/catalog.enums';
import { Category } from '../categories/domain/category';
import { AllConfigType } from '../config/config.type';
import { FileType } from '../files/domain/file';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { PaymentStatus } from '../payments/domain/payment';
import { PaymentsService } from '../payments/payments.service';
import { Product } from '../products/domain/product';
import { ProductsService } from '../products/products.service';
import { NewOrder, Order } from './domain/order';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  DuplicateOrderRequestError,
  InsufficientPortionsError,
  OrderRepository,
} from './infrastructure/persistence/order.repository';
import { OrderLifecycleService } from './order-lifecycle.service';
import { anOrder } from './order.fixture';
import { CancelledBy, Fulfillment, OrderStatus } from './order.enums';
import { OrdersService } from './orders.service';

// A Monday, 12:30 in Istanbul.
const NOW = new Date('2026-10-12T09:30:00Z');

const kitchen = Object.assign(new Kitchen(), {
  id: 'k1',
  ownerId: 7,
  name: 'Ayşe Teyze Mutfağı',
  latitude: 40.98771,
  longitude: 29.02249,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryTiers: [
    { upToKm: 2, feeKurus: 1500 },
    { upToKm: 5, feeKurus: 2500 },
  ],
  freeDeliveryMinKurus: 30000,
  minOrderKurus: null,
  hours: [{ dayOfWeek: 1, opensAt: '11:00', closesAt: '20:00' }],
  isPaused: false,
});

const product = (overrides: Partial<Product>): Product =>
  Object.assign(new Product(), {
    kitchenId: 'k1',
    category: Object.assign(new Category(), { id: 'c1', isActive: true }),
    isActive: true,
    photos: [],
    ...overrides,
  });

const MANTI = product({
  id: 'manti',
  name: 'Mantı',
  priceKurus: 14000,
  saleType: SaleType.onDemand,
  prepMinutes: 45,
  portionsAvailable: null,
  photos: [
    Object.assign(new FileType(), { id: 'f1', path: '/f1.png' }),
    Object.assign(new FileType(), { id: 'f2', path: '/f2.png' }),
  ],
});

const KOFTE = product({
  id: 'kofte',
  name: 'Mercimek köftesi',
  priceKurus: 9000,
  saleType: SaleType.dailyPortion,
  prepMinutes: null,
  portionsAvailable: 5,
});

const HOME = Object.assign(new Address(), {
  id: 'a1',
  fullAddress: 'Osmanağa Mh. No:30',
  district: 'Kadıköy',
  neighborhood: 'Osmanağa',
  buildingNo: '30',
  latitude: 40.988 + 1 / 111.19,
  longitude: 29.022,
});

const CONFIG: Record<string, number> = {
  'orders.acceptMinutes': 3,
  'orders.deliveryBufferMinutes': 15,
  'orders.serviceFeePercent': 5,
  'discovery.coordPrecision': 3,
};

const dto = (overrides: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
  kitchenId: 'k1',
  fulfillment: Fulfillment.pickup,
  items: [
    { productId: 'kofte', quantity: 2, note: '  ' },
    { productId: 'manti', quantity: 1, note: 'Az acılı' },
  ],
  note: 'Kapıda arayın',
  // 18000 + 14000 + 5% service
  expectedTotalKurus: 33600,
  acceptedTerms: true,
  ...overrides,
});

const build = () => {
  const repository = {
    findIdByRequestKey: jest.fn().mockResolvedValue(null),
    place: jest.fn().mockResolvedValue(anOrder()),
    findForCustomer: jest.fn().mockResolvedValue(anOrder()),
    listForCustomer: jest.fn().mockResolvedValue([anOrder()]),
    hasActiveOrders: jest.fn().mockResolvedValue(false),
    clearDeliveryAddresses: jest.fn(),
  };
  const lifecycle = {
    expireOverdue: jest.fn().mockResolvedValue(0),
    advance: jest
      .fn()
      .mockImplementation((order: Order) =>
        Promise.resolve({ ...order, status: OrderStatus.cancelled }),
      ),
  };
  const kitchens = {
    findById: jest.fn().mockResolvedValue(kitchen),
    findByOwner: jest.fn().mockResolvedValue(null),
  };
  const products = { findByIds: jest.fn().mockResolvedValue([MANTI, KOFTE]) };
  const addresses = { findOwned: jest.fn().mockResolvedValue(HOME) };
  const payments = {
    charge: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
    findByOrderId: jest.fn().mockResolvedValue({ status: PaymentStatus.paid }),
  };
  const config = { getOrThrow: (key: string) => CONFIG[key] };

  const service = new OrdersService(
    repository as unknown as OrderRepository,
    lifecycle as unknown as OrderLifecycleService,
    kitchens as unknown as KitchensService,
    products as unknown as ProductsService,
    addresses as unknown as AddressesService,
    payments as unknown as PaymentsService,
    config as unknown as ConfigService<AllConfigType>,
  );

  return {
    service,
    repository,
    lifecycle,
    kitchens,
    products,
    addresses,
    payments,
  };
};

describe('OrdersService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('quote', () => {
    it('should price the cart against the customer’s address', async () => {
      const { service, addresses } = build();

      const quote = await service.quote(9, {
        kitchenId: 'k1',
        fulfillment: Fulfillment.delivery,
        addressId: 'a1',
        items: [{ productId: 'manti', quantity: 1 }],
      });

      expect(addresses.findOwned).toHaveBeenCalledWith(9, 'a1');
      expect(quote).toMatchObject({
        subtotalKurus: 14000,
        deliveryFeeKurus: 1500,
        serviceFeeKurus: 700,
        totalKurus: 16200,
        distanceKm: 1,
        canOrder: true,
      });
    });

    it('should 404 a kitchen that is gone', async () => {
      const { service, kitchens } = build();
      kitchens.findById.mockResolvedValue(null);

      await expect(
        service.quote(9, {
          kitchenId: 'k1',
          fulfillment: Fulfillment.pickup,
          items: [{ productId: 'manti', quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('should snapshot the cart and place it in one go', async () => {
      const { service, repository, payments } = build();

      const result = await service.create(9, dto(), 'key-1');

      expect(result.created).toBe(true);
      const [{ order, requestKey, portions }, charge] = repository.place.mock
        .calls[0] as [
        { order: NewOrder; requestKey: string; portions: unknown },
        (draft: { id: string; totalKurus: number }) => Promise<unknown>,
      ];

      expect(requestKey).toBe('key-1');
      expect(portions).toEqual([{ productId: 'kofte', quantity: 2 }]);
      expect(order).toMatchObject({
        customerId: 9,
        kitchenId: 'k1',
        status: OrderStatus.pending,
        note: 'Kapıda arayın',
        subtotalKurus: 32000,
        serviceFeeKurus: 1600,
        totalKurus: 33600,
        deliveryAddress: null,
        expiresAt: new Date('2026-10-12T09:33:00Z'),
      });
      expect(order.pickupCode).toMatch(/^\d{4}$/);
      expect(order.items).toEqual([
        expect.objectContaining({
          productId: 'kofte',
          position: 0,
          unitPriceKurus: 9000,
          photo: null,
          note: null,
        }),
        expect.objectContaining({
          productId: 'manti',
          position: 1,
          prepMinutes: 45,
          photo: MANTI.photos[0],
          note: 'Az acılı',
        }),
      ]);

      await charge({ id: 'o1', totalKurus: 33600 });
      expect(payments.charge).toHaveBeenCalledWith('o1', 33600);
    });

    it('should copy the delivery address and leave out the pickup code', async () => {
      const { service, repository } = build();

      await service.create(
        9,
        dto({
          fulfillment: Fulfillment.delivery,
          addressId: 'a1',
          // 32000 ≥ 30000: free delivery
          expectedTotalKurus: 33600,
        }),
        'key-1',
      );

      expect(repository.place.mock.calls[0][0].order).toMatchObject({
        pickupCode: null,
        distanceKm: 1,
        deliveryFeeKurus: 0,
        deliveryAddress: {
          fullAddress: 'Osmanağa Mh. No:30',
          buildingNo: '30',
          floor: null,
        },
      });
    });

    it('should return the first order for a repeated key', async () => {
      const { service, repository } = build();
      repository.findIdByRequestKey.mockResolvedValue('o1');

      const result = await service.create(9, dto(), 'key-1');

      expect(result).toMatchObject({ created: false, order: { id: 'o1' } });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('should refuse what the quote blocks with dotted field errors', async () => {
      const { service, kitchens, repository } = build();
      kitchens.findById.mockResolvedValue({ ...kitchen, isPaused: true });

      const error = await service.create(9, dto(), 'key-1').catch((e) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { kitchenId: 'kitchen_closed' },
      });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('should answer a stale total with 409 and the new quote', async () => {
      const { service, repository } = build();

      const error = await service
        .create(9, dto({ expectedTotalKurus: 30000 }), 'key-1')
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        error: 'orderTotalChanged',
        data: { quote: { totalKurus: 33600, canOrder: true } },
      });
      expect(repository.place).not.toHaveBeenCalled();
    });

    it('should turn a lost race for the last portions into a 422 on that item', async () => {
      const { service, repository } = build();
      repository.place.mockRejectedValue(
        new InsufficientPortionsError('kofte'),
      );

      const error = await service.create(9, dto(), 'key-1').catch((e) => e);

      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        status: 422,
        errors: { 'items.0.productId': 'insufficient_portions' },
      });
    });

    it('should hand back the winner of a concurrent duplicate key', async () => {
      const { service, repository } = build();
      repository.place.mockRejectedValue(new DuplicateOrderRequestError());
      repository.findIdByRequestKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('o1');

      await expect(service.create(9, dto(), 'key-1')).resolves.toMatchObject({
        created: false,
        order: { id: 'o1' },
      });
    });
  });

  describe('cancel', () => {
    it('should expire overdue orders first, then cancel as the customer', async () => {
      const { service, lifecycle } = build();

      const order = await service.cancel(9, 'o1');

      expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ customerId: 9 });
      expect(lifecycle.advance).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'o1' }),
        'customerCancel',
        { cancelledBy: CancelledBy.customer, reason: null },
      );
      expect(order.status).toBe(OrderStatus.cancelled);
    });

    it('should 404 someone else’s order', async () => {
      const { service, repository } = build();
      repository.findForCustomer.mockResolvedValue(null);

      await expect(service.cancel(9, 'o1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('assertNoActiveOrders', () => {
    it('should check both sides after expiring their overdue orders', async () => {
      const { service, lifecycle, kitchens, repository } = build();
      kitchens.findByOwner.mockResolvedValue(kitchen);
      repository.hasActiveOrders.mockResolvedValue(true);

      const error = await service.assertNoActiveOrders(7).catch((e) => e);

      expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ customerId: 7 });
      expect(lifecycle.expireOverdue).toHaveBeenCalledWith({ kitchenId: 'k1' });
      expect(repository.hasActiveOrders).toHaveBeenCalledWith(7, 'k1');
      expect((error as ConflictException).getResponse()).toEqual({
        status: 409,
        error: 'activeOrdersExist',
      });
    });

    it('should pass without open orders', async () => {
      const { service, repository } = build();

      await expect(service.assertNoActiveOrders(9)).resolves.toBeUndefined();
      expect(repository.hasActiveOrders).toHaveBeenCalledWith(9, null);
    });
  });
});
