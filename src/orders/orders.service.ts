import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressesService } from '../addresses/addresses.service';
import { Address } from '../addresses/domain/address';
import { SaleType } from '../catalog/catalog.enums';
import { assertNoFieldErrors } from '../catalog/field-errors';
import { AllConfigType } from '../config/config.type';
import { Kitchen } from '../kitchens/domain/kitchen';
import { KitchensService } from '../kitchens/kitchens.service';
import { PaymentsService } from '../payments/payments.service';
import { Product } from '../products/domain/product';
import { ProductsService } from '../products/products.service';
import { User } from '../users/domain/user';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { orNotFound } from '../utils/or-not-found';
import { DeliveryAddress, NewOrder, Order } from './domain/order';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders.dto';
import { QuoteOrderDto } from './dto/quote-order.dto';
import {
  DuplicateOrderRequestError,
  InsufficientPortionsError,
  OrderRepository,
} from './infrastructure/persistence/order.repository';
import { generatePickupCode } from './order-codes';
import { activeOrdersExist, orderTotalChanged } from './order-errors';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderQuote, quoteFieldErrors, quoteOrder } from './order-pricing';
import { CustomerCardTrust, OrderTrustService } from './order-trust.service';
import { ACTIVE_STATUSES, CLOSED_STATUSES } from './order-status';
import {
  CancelledBy,
  Fulfillment,
  OrderScope,
  OrderStatus,
} from './order.enums';
import { customerOrderCard, customerOrderDetail } from './presenters';
import { CustomerOrderCard, CustomerOrderDetail } from './views';

const MINUTE_MS = 60_000;

type Priced = {
  quote: OrderQuote;
  kitchen: Kitchen;
  products: Product[];
  address: Address | null;
};

const deliveryAddressOf = (address: Address): DeliveryAddress => ({
  fullAddress: address.fullAddress,
  district: address.district,
  neighborhood: address.neighborhood,
  buildingNo: address.buildingNo ?? null,
  floor: address.floor ?? null,
  apartmentNo: address.apartmentNo ?? null,
  directions: address.directions ?? null,
  latitude: address.latitude,
  longitude: address.longitude,
});

const textOrNull = (text: string | null | undefined) => text?.trim() || null;

/** The customer's side of ordering: quote, place, follow, cancel. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly lifecycle: OrderLifecycleService,
    private readonly kitchensService: KitchensService,
    private readonly productsService: ProductsService,
    private readonly addressesService: AddressesService,
    private readonly paymentsService: PaymentsService,
    private readonly trust: OrderTrustService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async quote(customerId: User['id'], dto: QuoteOrderDto): Promise<OrderQuote> {
    return (await this.price(customerId, dto, new Date())).quote;
  }

  /**
   * Places the order: same pricing as the quote, then one transaction that
   * takes the portions and the payment. A repeated Idempotency-Key returns
   * the first order (`created: false`).
   */
  async create(
    customerId: User['id'],
    dto: CreateOrderDto,
    idempotencyKey: string,
  ): Promise<{ order: CustomerOrderDetail; created: boolean }> {
    const replayed = await this.replay(customerId, idempotencyKey);

    if (replayed) {
      return { order: replayed, created: false };
    }

    const now = new Date();
    const { quote, kitchen, products, address } = await this.price(
      customerId,
      dto,
      now,
    );

    assertNoFieldErrors(quoteFieldErrors(quote, dto.items));

    if (quote.totalKurus !== dto.expectedTotalKurus) {
      throw orderTotalChanged(quote);
    }

    const order = this.draft(
      customerId,
      dto,
      quote,
      kitchen,
      products,
      address,
      now,
    );

    try {
      const placed = await this.orderRepository.place(
        {
          order,
          requestKey: idempotencyKey,
          portions: order.items
            .filter((item) => item.saleType === SaleType.dailyPortion)
            .map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
        },
        (draft) => this.paymentsService.charge(draft.id, draft.totalKurus),
      );

      return { order: await this.present(placed), created: true };
    } catch (error) {
      if (error instanceof DuplicateOrderRequestError) {
        const first = await this.replay(customerId, idempotencyKey);

        if (first) {
          return { order: first, created: false };
        }
      }

      if (error instanceof InsufficientPortionsError) {
        const index = dto.items.findIndex(
          (item) => item.productId === error.productId,
        );
        assertNoFieldErrors({
          [`items.${index}.productId`]: 'insufficient_portions',
        });
      }

      throw error;
    }
  }

  async list(
    customerId: User['id'],
    query: ListOrdersQueryDto,
  ): Promise<InfinityPaginationResponseDto<CustomerOrderCard>> {
    await this.lifecycle.expireOverdue({ customerId });

    const orders = await this.orderRepository.listForCustomer(
      customerId,
      query.scope === OrderScope.active ? ACTIVE_STATUSES : CLOSED_STATUSES,
      { offset: (query.page - 1) * query.limit, limit: query.limit },
    );

    const trust = await this.trust.forCustomerCards(orders);

    return infinityPagination(
      orders.map((order) =>
        customerOrderCard(order, trust.get(order.id) as CustomerCardTrust),
      ),
      { page: query.page, limit: query.limit },
    );
  }

  async detail(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<CustomerOrderDetail> {
    await this.lifecycle.expireOverdue({ customerId });

    return this.present(
      await orNotFound(this.orderRepository.findForCustomer(customerId, id)),
    );
  }

  /** Only while the cook has not answered; anything later is a 409. */
  async cancel(
    customerId: User['id'],
    id: Order['id'],
  ): Promise<CustomerOrderDetail> {
    await this.lifecycle.expireOverdue({ customerId });
    const order = await orNotFound(
      this.orderRepository.findForCustomer(customerId, id),
    );

    return this.present(
      await this.lifecycle.advance(order, 'customerCancel', {
        cancelledBy: CancelledBy.customer,
        reason: null,
      }),
    );
  }

  /** Account deletion is refused while an order is open on either side. */
  async assertNoActiveOrders(userId: User['id']): Promise<void> {
    const kitchen = await this.kitchensService.findByOwner(userId);

    await this.lifecycle.expireOverdue({ customerId: userId });

    if (kitchen) {
      await this.lifecycle.expireOverdue({ kitchenId: kitchen.id });
    }

    if (
      await this.orderRepository.hasActiveOrders(userId, kitchen?.id ?? null)
    ) {
      throw activeOrdersExist();
    }
  }

  /** Account deletion (KVKK): the customer's address copies go with the account. */
  clearDeliveryAddresses(customerId: User['id']): Promise<void> {
    return this.orderRepository.clearDeliveryAddresses(customerId);
  }

  private async price(
    customerId: User['id'],
    dto: QuoteOrderDto | CreateOrderDto,
    now: Date,
  ): Promise<Priced> {
    const kitchen = await orNotFound(
      this.kitchensService.findById(dto.kitchenId),
    );
    const address =
      dto.fulfillment === Fulfillment.delivery && dto.addressId
        ? await this.addressesService.findOwned(customerId, dto.addressId)
        : null;
    const products = await this.productsService.findByIds(
      dto.items.map((item) => item.productId),
    );

    const quote = quoteOrder({
      kitchen,
      products,
      items: dto.items,
      fulfillment: dto.fulfillment,
      address,
      customerId,
      now,
      config: {
        serviceFeePercent: this.configService.getOrThrow(
          'orders.serviceFeePercent',
          { infer: true },
        ),
        deliveryBufferMinutes: this.bufferMinutes(),
        coordPrecision: this.configService.getOrThrow(
          'discovery.coordPrecision',
          { infer: true },
        ),
      },
    });

    return { quote, kitchen, products, address };
  }

  private draft(
    customerId: User['id'],
    dto: CreateOrderDto,
    quote: OrderQuote,
    kitchen: Kitchen,
    products: Product[],
    address: Address | null,
    now: Date,
  ): NewOrder {
    const byId = new Map(products.map((product) => [product.id, product]));
    const acceptMinutes = this.configService.getOrThrow(
      'orders.acceptMinutes',
      { infer: true },
    );

    return {
      customerId,
      kitchenId: kitchen.id,
      status: OrderStatus.pending,
      fulfillment: dto.fulfillment,
      deliveryAddress: address ? deliveryAddressOf(address) : null,
      distanceKm: quote.distanceKm,
      note: textOrNull(dto.note),
      subtotalKurus: quote.subtotalKurus,
      deliveryFeeKurus: quote.deliveryFeeKurus,
      serviceFeeKurus: quote.serviceFeeKurus,
      totalKurus: quote.totalKurus,
      pickupCode:
        dto.fulfillment === Fulfillment.pickup ? generatePickupCode() : null,
      expiresAt: new Date(now.getTime() + acceptMinutes * MINUTE_MS),
      estimatedReadyAt: null,
      acceptedAt: null,
      preparingAt: null,
      readyAt: null,
      onTheWayAt: null,
      completedAt: null,
      closedAt: null,
      cancelledBy: null,
      reason: null,
      // canOrder held, so every product is here.
      items: dto.items.map((item, position) => {
        const product = byId.get(item.productId) as Product;

        return {
          productId: product.id,
          position,
          name: product.name,
          unitPriceKurus: product.priceKurus,
          saleType: product.saleType,
          prepMinutes: product.prepMinutes,
          photo: product.photos[0] ?? null,
          quantity: item.quantity,
          note: textOrNull(item.note),
        };
      }),
    };
  }

  private async replay(
    customerId: User['id'],
    idempotencyKey: string,
  ): Promise<CustomerOrderDetail | null> {
    const id = await this.orderRepository.findIdByRequestKey(
      customerId,
      idempotencyKey,
    );
    return id ? this.detail(customerId, id) : null;
  }

  private async present(order: Order): Promise<CustomerOrderDetail> {
    const [payment, trust] = await Promise.all([
      this.paymentsService.findByOrderId(order.id),
      this.trust.forCustomer(order),
    ]);
    return customerOrderDetail(
      order,
      payment?.status ?? null,
      this.bufferMinutes(),
      trust,
    );
  }

  private bufferMinutes(): number {
    return this.configService.getOrThrow('orders.deliveryBufferMinutes', {
      infer: true,
    });
  }
}
