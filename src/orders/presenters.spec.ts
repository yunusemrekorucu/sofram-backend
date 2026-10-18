import { anIssue } from '../order-issues/order-issue.fixture';
import { PaymentStatus } from '../payments/domain/payment';
import { aReview } from '../reviews/review.fixture';
import { CookOrderTrust, CustomerOrderTrust } from './order-trust.service';
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

const CUSTOMER_TRUST: CustomerOrderTrust = {
  review: null,
  canReview: false,
  issue: null,
  canReportIssue: false,
  unreadMessages: 0,
  canMessage: true,
};

const COOK_TRUST: CookOrderTrust = {
  review: null,
  issue: null,
  unreadMessages: 0,
  canMessage: true,
};

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
    expect(
      customerOrderCard(anOrder(), { unreadMessages: 2, canReview: true }),
    ).toMatchObject({
      code: 'S-7K3F',
      kitchen: { id: 'k1', name: 'Ayşe Teyze Mutfağı', coverPhoto: null },
      items: [{ name: 'Mantı', quantity: 2 }],
      totalKurus: 29400,
      unreadMessages: 2,
      canReview: true,
    });
  });
});

describe('customerOrderDetail', () => {
  it('should show the pickup code, the cook card and the payment', () => {
    expect(
      customerOrderDetail(anOrder(), PaymentStatus.paid, 15, CUSTOMER_TRUST),
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
        CUSTOMER_TRUST,
      ).estimatedMinutes,
    ).toBeNull();
  });

  it('should never carry the cook’s or the customer’s contact details', () => {
    const detail = customerOrderDetail(anOrder(), null, 15, CUSTOMER_TRUST);

    expect(detail).not.toHaveProperty('customer');
    expect(detail).not.toHaveProperty('customerId');
    expect(detail.kitchen).not.toHaveProperty('ownerId');
    expect(detail.payment).toBeNull();
  });
});

describe('cook views', () => {
  it('should name the customer briefly and keep the pickup code out', () => {
    for (const view of [
      cookOrderCard(anOrder(), 0),
      cookOrderDetail(anOrder(), COOK_TRUST),
    ]) {
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
        COOK_TRUST,
      ).deliveryAddress,
    ).toEqual(deliveryAddress);
  });
});

describe('trust on order screens', () => {
  const trust: CustomerOrderTrust = {
    review: aReview({ reply: 'Afiyet olsun' }),
    canReview: false,
    issue: anIssue({ adminNote: 'İade edildi', refundKurus: 6500 }),
    canReportIssue: false,
    unreadMessages: 3,
    canMessage: false,
  };

  it('should show the customer their review, the latest issue and the chat state', () => {
    const detail = customerOrderDetail(
      anOrder({ status: OrderStatus.completed }),
      PaymentStatus.paid,
      15,
      trust,
    );

    expect(detail).toMatchObject({
      review: { id: 'r1', rating: 5, reply: 'Afiyet olsun' },
      canReview: false,
      issue: {
        id: 'is1',
        category: 'missing_item',
        status: 'open',
        refundKurus: 6500,
        adminNote: 'İade edildi',
      },
      canReportIssue: false,
      unreadMessages: 3,
      canMessage: false,
    });
    expect(detail.issue).not.toHaveProperty('description');
    expect(detail.review).not.toHaveProperty('authorName');
  });

  it('should show the cook the same review and issue, read-only', () => {
    expect(
      cookOrderDetail(anOrder(), {
        review: trust.review,
        issue: trust.issue,
        unreadMessages: 1,
        canMessage: true,
      }),
    ).toMatchObject({
      review: { id: 'r1' },
      issue: { id: 'is1', adminNote: 'İade edildi' },
      unreadMessages: 1,
      canMessage: true,
    });
  });
});
