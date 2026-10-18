import { SaleType } from '../../../../../catalog/catalog.enums';
import { FileType } from '../../../../../files/domain/file';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { KitchenEntity } from '../../../../../kitchens/infrastructure/persistence/relational/entities/kitchen.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { Fulfillment, OrderStatus } from '../../../../order.enums';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemMapper } from './order-item.mapper';
import { OrderMapper } from './order.mapper';

const item = (position: number, name: string) =>
  Object.assign(new OrderItemEntity(), {
    id: `i${position}`,
    orderId: 'o1',
    productId: `p${position}`,
    position,
    name,
    unitPriceKurus: 14000,
    saleType: SaleType.onDemand,
    prepMinutes: 45,
    photo: position === 0 ? { id: 'f1', path: '/f1.png' } : null,
    quantity: 1,
    note: null,
  });

const entity = (): OrderEntity =>
  Object.assign(new OrderEntity(), {
    id: 'o1',
    code: 'S-7K3F',
    customerId: 9,
    kitchenId: 'k1',
    status: OrderStatus.pending,
    fulfillment: Fulfillment.pickup,
    deliveryAddress: null,
    distanceKm: null,
    note: 'Kapıda arayın',
    subtotalKurus: 28000,
    deliveryFeeKurus: 0,
    serviceFeeKurus: 1400,
    totalKurus: 29400,
    pickupCode: '0427',
    items: [item(1, 'Sütlaç'), item(0, 'Mantı')],
    kitchen: Object.assign(new KitchenEntity(), {
      id: 'k1',
      ownerId: 7,
      name: 'Ayşe Teyze Mutfağı',
      coverPhoto: { id: 'c1', path: '/c1.png' },
      district: 'Kadıköy',
      fullAddress: 'Caferağa Mh. Moda Cd. No:10',
      latitude: 40.9862,
      longitude: 29.0254,
      owner: Object.assign(new UserEntity(), {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        photo: Object.assign(new FileEntity(), { id: 'u1', path: '/u1.png' }),
      }),
    }),
    customer: Object.assign(new UserEntity(), {
      firstName: 'Deniz',
      lastName: 'Arslan',
    }),
  });

describe('OrderMapper.toDomain', () => {
  it('should keep cart order and turn snapshots into files', () => {
    const order = OrderMapper.toDomain(entity());

    expect(order.items.map((i) => i.name)).toEqual(['Mantı', 'Sütlaç']);
    expect(order.items[0].photo).toBeInstanceOf(FileType);
    expect(order.items[1].photo).toBeNull();
    expect(order.kitchen.coverPhoto).toBeInstanceOf(FileType);
  });

  it('should carry the kitchen card, the cook and the customer names', () => {
    expect(OrderMapper.toDomain(entity())).toMatchObject({
      code: 'S-7K3F',
      pickupCode: '0427',
      kitchen: {
        id: 'k1',
        ownerId: 7,
        district: 'Kadıköy',
        cook: { firstName: 'Ayşe', lastName: 'Yılmaz', photo: { id: 'u1' } },
      },
      customer: { firstName: 'Deniz', lastName: 'Arslan' },
    });
  });

  it('should tolerate an anonymized customer and a cook without a photo', () => {
    const raw = entity();
    (raw.kitchen as KitchenEntity).owner = Object.assign(new UserEntity(), {
      firstName: null,
      lastName: null,
      photo: null,
    });
    raw.customer = Object.assign(new UserEntity(), {
      firstName: null,
      lastName: null,
    });

    expect(OrderMapper.toDomain(raw)).toMatchObject({
      kitchen: { cook: { firstName: null, photo: null } },
      customer: { firstName: null, lastName: null },
    });
  });
});

describe('OrderItemMapper.toPersistence', () => {
  it('should snapshot the photo and attach the order', () => {
    const row = OrderItemMapper.toPersistence(
      {
        productId: 'p1',
        position: 0,
        name: 'Mantı',
        unitPriceKurus: 14000,
        saleType: SaleType.onDemand,
        prepMinutes: 45,
        photo: Object.assign(new FileType(), { id: 'f1', path: '/f1.png' }),
        quantity: 2,
        note: 'Az acılı',
      },
      'o1',
    );

    expect(row).toMatchObject({
      orderId: 'o1',
      photo: { id: 'f1', path: '/f1.png' },
      quantity: 2,
    });
    expect(row.photo).not.toBeInstanceOf(FileType);
  });
});
