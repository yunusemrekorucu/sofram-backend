import { PaymentStatus } from '../payments/domain/payment';
import { anOrder } from './order.fixture';
import { Fulfillment, OrderStatus } from './order.enums';
import {
  cookOrderCard,
  cookOrderDetail,
  customerOrderCard,
  customerOrderDetail,
  kitchenAddressFor,
  shortName,
} from './presenters';

describe('shortName', () => {
  it('should keep the first name and the Turkish initial of the last', () => {
    expect(shortName({ firstName: 'Ayşe', lastName: 'yılmaz' })).toBe(
      'Ayşe Y.',
    );
    expect(shortName({ firstName: 'Deniz', lastName: 'İnce' })).toBe(
      'Deniz İ.',
    );
    expect(shortName({ firstName: 'Can', lastName: 'ışık' })).toBe('Can I.');
  });

  it('should cope with a missing last name or a deleted account', () => {
    expect(shortName({ firstName: 'Ayşe', lastName: null })).toBe('Ayşe');
    expect(shortName({ firstName: null, lastName: null })).toBeNull();
  });
});

describe('kitchenAddressFor', () => {
  it('should open the exact address for pickup from accepted to ready', () => {
    for (const status of [
      OrderStatus.accepted,
      OrderStatus.preparing,
      OrderStatus.ready,
    ]) {
      expect(kitchenAddressFor(anOrder({ status }))).toEqual({
        fullAddress: 'Caferağa Mh. Moda Cd. No:10',
        latitude: 40.98771,
        longitude: 29.02249,
      });
    }
  });

  it('should keep it closed before acceptance, after closing and for delivery', () => {
    for (const status of [
      OrderStatus.pending,
      OrderStatus.completed,
      OrderStatus.cancelled,
    ]) {
      expect(kitchenAddressFor(anOrder({ status }))).toBeNull();
    }

    expect(
      kitchenAddressFor(
        anOrder({
          status: OrderStatus.accepted,
          fulfillment: Fulfillment.delivery,
        }),
      ),
    ).toBeNull();
  });
});

describe('customerOrderCard', () => {
  it('should summarize the items and the kitchen', () => {
    expect(customerOrderCard(anOrder())).toMatchObject({
      code: 'S-7K3F',
      kitchen: { id: 'k1', name: 'Ayşe Teyze Mutfağı', coverPhoto: null },
      items: [{ name: 'Mantı', quantity: 2 }],
      totalKurus: 29400,
    });
  });
});

describe('customerOrderDetail', () => {
  it('should show the pickup code, the cook card and the payment', () => {
    expect(
      customerOrderDetail(anOrder(), PaymentStatus.paid, 15),
    ).toMatchObject({
      pickupCode: '0427',
      kitchen: { cookName: 'Ayşe Y.', district: 'Kadıköy' },
      kitchenAddress: null,
      estimatedMinutes: 45,
      payment: { status: PaymentStatus.paid },
      items: [{ name: 'Mantı', note: 'Az acılı', photo: { id: 'f1' } }],
    });
  });

  it('should drop estimatedMinutes once the cook has answered', () => {
    expect(
      customerOrderDetail(
        anOrder({ status: OrderStatus.accepted }),
        PaymentStatus.paid,
        15,
      ).estimatedMinutes,
    ).toBeNull();
  });

  it('should never carry the cook’s or the customer’s contact details', () => {
    const detail = customerOrderDetail(anOrder(), null, 15);

    expect(detail).not.toHaveProperty('customer');
    expect(detail).not.toHaveProperty('customerId');
    expect(detail.kitchen).not.toHaveProperty('ownerId');
    expect(detail.payment).toBeNull();
  });
});

describe('cook views', () => {
  it('should name the customer briefly and keep the pickup code out', () => {
    for (const view of [cookOrderCard(anOrder()), cookOrderDetail(anOrder())]) {
      expect(view).toMatchObject({
        customerName: 'Deniz İ.',
        items: [{ name: 'Mantı', note: 'Az acılı' }],
        note: 'Kapıda arayın',
      });
      expect(view).not.toHaveProperty('pickupCode');
      expect(view).not.toHaveProperty('customerId');
      expect(view).not.toHaveProperty('payment');
    }
  });

  it('should show the delivery address to the cook', () => {
    const deliveryAddress = {
      fullAddress: 'Osmanağa Mh. No:30',
      district: 'Kadıköy',
      neighborhood: 'Osmanağa',
      buildingNo: '30',
      floor: '2',
      apartmentNo: '4',
      directions: null,
      latitude: 40.99,
      longitude: 29.03,
    };

    expect(
      cookOrderDetail(
        anOrder({ fulfillment: Fulfillment.delivery, deliveryAddress }),
      ).deliveryAddress,
    ).toEqual(deliveryAddress);
  });
});
