import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddressEntity } from '../../../../addresses/infrastructure/persistence/relational/entities/address.entity';
import { AuthProvidersEnum } from '../../../../auth/auth-providers.enum';
import { deliveryFeeFor } from '../../../../catalog/delivery';
import {
  haversineKm,
  roundCoord,
  roundDistance,
} from '../../../../catalog/geo';
import { KitchenEntity } from '../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import {
  generateOrderCode,
  generatePickupCode,
} from '../../../../orders/order-codes';
import {
  estimatedMinutesFor,
  estimatedReadyAt,
} from '../../../../orders/order-pricing';
import { ROLLBACK_STATUSES } from '../../../../orders/order-status';
import {
  CancelledBy,
  Fulfillment,
  OrderReason,
  OrderStatus,
} from '../../../../orders/order.enums';
import { OrderItemEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { OrderEntity } from '../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { PaymentStatus } from '../../../../payments/domain/payment';
import { PaymentEntity } from '../../../../payments/infrastructure/persistence/relational/entities/payment.entity';
import { ProductEntity } from '../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';

const COOK_PHONE = '+905550000101';

const CUSTOMER = {
  phoneNumber: '+905550000201',
  firstName: 'Deniz',
  lastName: 'Arslan',
};

const ADDRESS = {
  title: 'Ev',
  fullAddress: 'Osmanağa Mh. Söğütlüçeşme Cd. No:30 D:4',
  district: 'Kadıköy',
  neighborhood: 'Osmanağa',
  buildingNo: '30',
  floor: '2',
  apartmentNo: '4',
  directions: 'Eczanenin üstü',
  latitude: 40.9905,
  longitude: 29.0282,
};

// The defaults of ORDER_SERVICE_FEE_PERCENT, ORDER_DELIVERY_BUFFER_MINUTES and
// DISCOVERY_COORD_PRECISION; the seed runs without the app's config.
const SERVICE_FEE_PERCENT = 5;
const DELIVERY_BUFFER_MINUTES = 15;
const COORD_PRECISION = 3;
const MINUTE_MS = 60_000;

type SeedOrder = {
  status: OrderStatus;
  fulfillment: Fulfillment;
  /** [product name, quantity] from the first seed kitchen's menu. */
  items: [string, number][];
  minutesAgo: number;
  cancelledBy?: CancelledBy;
  reason?: OrderReason;
};

/** One order per status except pending (it would expire within minutes). */
const ORDERS: SeedOrder[] = [
  {
    status: OrderStatus.accepted,
    fulfillment: Fulfillment.pickup,
    items: [['Ev usulü mantı', 1]],
    minutesAgo: 10,
  },
  {
    status: OrderStatus.preparing,
    fulfillment: Fulfillment.delivery,
    items: [['Karnıyarık', 2]],
    minutesAgo: 25,
  },
  {
    status: OrderStatus.ready,
    fulfillment: Fulfillment.pickup,
    items: [
      ['Mercimek çorbası', 2],
      ['Fırın sütlaç', 1],
    ],
    minutesAgo: 40,
  },
  {
    status: OrderStatus.onTheWay,
    fulfillment: Fulfillment.delivery,
    items: [
      ['Ev usulü mantı', 2],
      ['Fırın sütlaç', 2],
    ],
    minutesAgo: 55,
  },
  {
    status: OrderStatus.completed,
    fulfillment: Fulfillment.pickup,
    items: [['Karnıyarık', 1]],
    minutesAgo: 120,
  },
  {
    status: OrderStatus.rejected,
    fulfillment: Fulfillment.delivery,
    items: [['Mercimek çorbası', 1]],
    minutesAgo: 180,
    reason: OrderReason.tooBusy,
  },
  {
    status: OrderStatus.cancelled,
    fulfillment: Fulfillment.pickup,
    items: [['Fırın sütlaç', 1]],
    minutesAgo: 240,
    cancelledBy: CancelledBy.customer,
  },
  {
    status: OrderStatus.expired,
    fulfillment: Fulfillment.delivery,
    items: [['Ev usulü mantı', 1]],
    minutesAgo: 300,
    cancelledBy: CancelledBy.system,
  },
];

/** Minutes after creation each step happened, in order. */
const STEPS = [
  ['acceptedAt', 2],
  ['preparingAt', 5],
  ['readyAt', 30],
  ['onTheWayAt', 35],
  ['completedAt', 45],
] as const;

/** How many STEPS an order in this status went through. */
const STEPS_TAKEN: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.accepted]: 1,
  [OrderStatus.preparing]: 2,
  [OrderStatus.ready]: 3,
  [OrderStatus.onTheWay]: 4,
  [OrderStatus.completed]: 5,
};

/**
 * Development data only: a customer (`dev:+905550000201`) with an order in
 * every status but pending at the first seed kitchen (`dev:+905550000101`).
 * Portions are not taken (these are history), payments are `dev`.
 */
@Injectable()
export class OrderSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(AddressEntity)
    private readonly addresses: Repository<AddressEntity>,
    @InjectRepository(KitchenEntity)
    private readonly kitchens: Repository<KitchenEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly items: Repository<OrderItemEntity>,
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
  ) {}

  async run() {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const cook = await this.users.findOne({
      where: { phoneNumber: COOK_PHONE },
    });
    const kitchen = cook
      ? await this.kitchens.findOne({ where: { ownerId: cook.id } })
      : null;

    if (
      !kitchen ||
      (await this.orders.exists({ where: { kitchenId: kitchen.id } }))
    ) {
      return;
    }

    const customer = await this.customer();
    const menu = new Map(
      (await this.products.find({ where: { kitchenId: kitchen.id } })).map(
        (product) => [product.name, product],
      ),
    );

    for (const seed of ORDERS) {
      await this.order(seed, kitchen, customer, menu);
    }
  }

  private async customer(): Promise<UserEntity> {
    const existing = await this.users.findOne({
      where: { phoneNumber: CUSTOMER.phoneNumber },
    });
    const customer =
      existing ??
      (await this.users.save(
        this.users.create({
          ...CUSTOMER,
          email: null,
          provider: AuthProvidersEnum.phone,
          kvkkAcceptedAt: new Date(),
          role: { id: RoleEnum.user },
          status: { id: StatusEnum.active },
        }),
      ));

    if (
      !(await this.addresses.exists({ where: { user: { id: customer.id } } }))
    ) {
      await this.addresses.save(
        this.addresses.create({ ...ADDRESS, isDefault: true, user: customer }),
      );
    }

    return customer;
  }

  private async order(
    seed: SeedOrder,
    kitchen: KitchenEntity,
    customer: UserEntity,
    menu: Map<string, ProductEntity>,
  ): Promise<void> {
    const createdAt = new Date(Date.now() - seed.minutesAgo * MINUTE_MS);
    const at = (minutes: number) =>
      new Date(createdAt.getTime() + minutes * MINUTE_MS);
    const lines = seed.items.map(([name, quantity], position) => ({
      product: menu.get(name) as ProductEntity,
      quantity,
      position,
    }));
    const subtotalKurus = lines.reduce(
      (sum, line) => sum + line.product.priceKurus * line.quantity,
      0,
    );
    const isDelivery = seed.fulfillment === Fulfillment.delivery;
    const distanceKm = haversineKm(ADDRESS, {
      latitude: roundCoord(kitchen.latitude, COORD_PRECISION),
      longitude: roundCoord(kitchen.longitude, COORD_PRECISION),
    });
    const freeDelivery =
      kitchen.freeDeliveryMinKurus !== null &&
      subtotalKurus >= kitchen.freeDeliveryMinKurus;
    const deliveryFeeKurus =
      isDelivery && !freeDelivery
        ? (deliveryFeeFor(kitchen.deliveryTiers, distanceKm) ?? 0)
        : 0;
    const serviceFeeKurus = Math.round(
      (subtotalKurus * SERVICE_FEE_PERCENT) / 100,
    );
    const totalKurus = subtotalKurus + deliveryFeeKurus + serviceFeeKurus;
    const stamps: Partial<Record<(typeof STEPS)[number][0], Date>> =
      Object.fromEntries(
        STEPS.slice(0, STEPS_TAKEN[seed.status] ?? 0)
          .filter(([step]) => isDelivery || step !== 'onTheWayAt')
          .map(([step, minutes]) => [step, at(minutes)]),
      );
    const closed = ROLLBACK_STATUSES.includes(seed.status);

    const order = await this.orders.save(
      this.orders.create({
        code: generateOrderCode(),
        customerId: customer.id,
        kitchenId: kitchen.id,
        status: seed.status,
        fulfillment: seed.fulfillment,
        deliveryAddress: isDelivery
          ? {
              fullAddress: ADDRESS.fullAddress,
              district: ADDRESS.district,
              neighborhood: ADDRESS.neighborhood,
              buildingNo: ADDRESS.buildingNo,
              floor: ADDRESS.floor,
              apartmentNo: ADDRESS.apartmentNo,
              directions: ADDRESS.directions,
              latitude: ADDRESS.latitude,
              longitude: ADDRESS.longitude,
            }
          : null,
        distanceKm: isDelivery ? roundDistance(distanceKm) : null,
        note: null,
        subtotalKurus,
        deliveryFeeKurus,
        serviceFeeKurus,
        totalKurus,
        pickupCode: isDelivery ? null : generatePickupCode(),
        expiresAt: at(3),
        estimatedReadyAt: stamps.acceptedAt
          ? estimatedReadyAt(
              stamps.acceptedAt,
              estimatedMinutesFor(
                lines.map((line) => line.product),
                seed.fulfillment,
                DELIVERY_BUFFER_MINUTES,
              ),
            )
          : null,
        acceptedAt: stamps.acceptedAt ?? null,
        preparingAt: stamps.preparingAt ?? null,
        readyAt: stamps.readyAt ?? null,
        onTheWayAt: stamps.onTheWayAt ?? null,
        completedAt: stamps.completedAt ?? null,
        closedAt: closed ? at(3) : null,
        cancelledBy: seed.cancelledBy ?? null,
        reason: seed.reason ?? null,
        createdAt,
      }),
    );

    await this.items.save(
      lines.map(({ product, quantity, position }) =>
        this.items.create({
          orderId: order.id,
          productId: product.id,
          position,
          name: product.name,
          unitPriceKurus: product.priceKurus,
          saleType: product.saleType,
          prepMinutes: product.prepMinutes,
          photo: product.photos[0] ?? null,
          quantity,
          note: null,
        }),
      ),
    );

    await this.payments.save(
      this.payments.create({
        orderId: order.id,
        provider: 'dev',
        providerRef: `dev_seed_${order.code}`,
        amountKurus: totalKurus,
        status: closed ? PaymentStatus.refunded : PaymentStatus.paid,
        paidAt: createdAt,
        refundedAt: closed ? at(3) : null,
      }),
    );
  }
}
