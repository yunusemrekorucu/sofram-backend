import { beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  addAddress,
  addProduct,
  categoryId,
  northOf,
  openKitchen,
  phoneLogin,
  randomSpot,
  setName,
  uniquePhone,
} from '../utils/orders';

type Card = { id: string } & Record<string, unknown>;
const ids = (body: { data: { data: Card[] } }) =>
  body.data.data.map((item) => item.id);

describe('Orders', () => {
  const app = APP_URL;
  const HOME = randomSpot();
  const customerPhone = uniquePhone('+90562');
  let cook: string;
  let customer: string;
  let kitchenId: string;
  let mantiId: string;
  let kofteId: string;
  let nearId: string;
  let farId: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token: string) =>
    request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const portionsOf = async (productId: string): Promise<number> => {
    const { body } = await get('/kitchens/me/products', cook).expect(200);
    return body.data.find((p: { id: string }) => p.id === productId)
      .portionsAvailable;
  };

  /** 2× köfte (daily) + 1× mantı (on demand), pickup: 32000 + 5% = 33600. */
  const cart = (overrides: Record<string, unknown> = {}) => ({
    kitchenId,
    fulfillment: 'pickup',
    items: [
      { productId: kofteId, quantity: 2, note: 'Az acılı' },
      { productId: mantiId, quantity: 1 },
    ],
    ...overrides,
  });

  const quote = (body: Record<string, unknown>, token = customer) =>
    post('/orders/quote', token).send(body);

  const placeOrder = (body: Record<string, unknown>, key = randomUUID()) =>
    post('/orders', customer)
      .set('Idempotency-Key', key)
      .send({ acceptedTerms: true, ...body });

  beforeAll(async () => {
    cook = await phoneLogin(uniquePhone('+90561'));
    customer = await phoneLogin(customerPhone);
    await setName(cook, 'Ayşe', 'Yılmaz');
    await setName(customer, 'Deniz', 'Arslan');

    kitchenId = await openKitchen(cook, HOME);
    const mainDish = await categoryId(cook, 'main-dish');
    mantiId = await addProduct(cook, {
      categoryId: mainDish,
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    kofteId = await addProduct(cook, {
      categoryId: mainDish,
      name: 'Mercimek köftesi',
      priceKurus: 9000,
      saleType: 'daily_portion',
      portionsAvailable: 5,
    });

    nearId = await addAddress(customer, northOf(HOME, 1));
    farId = await addAddress(customer, northOf(HOME, 10));
  });

  describe('quote', () => {
    it('should price a pickup order', () =>
      quote(cart({ items: [{ productId: mantiId, quantity: 1 }] }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({
            subtotalKurus: 14000,
            deliveryFeeKurus: 0,
            serviceFeeKurus: 700,
            totalKurus: 14700,
            freeDeliveryRemainingKurus: null,
            minOrderRemainingKurus: null,
            distanceKm: null,
            estimatedMinutes: 45,
            issues: [],
            blockers: [],
            canOrder: true,
          });
        }));

    it('should charge the delivery tier below the free-delivery threshold', () =>
      quote(
        cart({
          fulfillment: 'delivery',
          addressId: nearId,
          items: [{ productId: mantiId, quantity: 1 }],
        }),
      )
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            deliveryFeeKurus: 1500,
            totalKurus: 16200,
            freeDeliveryRemainingKurus: 16000,
            estimatedMinutes: 60,
            canOrder: true,
          });
          expect(body.data.distanceKm).toBeCloseTo(1, 0);
        }));

    it('should deliver for free from the threshold on', () =>
      quote(
        cart({
          fulfillment: 'delivery',
          addressId: nearId,
          items: [{ productId: mantiId, quantity: 3 }],
        }),
      )
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            subtotalKurus: 42000,
            deliveryFeeKurus: 0,
            serviceFeeKurus: 2100,
            freeDeliveryRemainingKurus: null,
          });
        }));

    it('should block an address beyond the last tier', () =>
      quote(cart({ fulfillment: 'delivery', addressId: farId }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            blockers: ['out_of_range'],
            canOrder: false,
          });
        }));

    it('should block an order below the kitchen minimum', async () => {
      await patch('/kitchens/me', cook)
        .send({ minOrderKurus: 50000 })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.minOrderKurus).toBe(50000);
        });

      await quote(cart({ items: [{ productId: mantiId, quantity: 1 }] }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            blockers: ['below_minimum'],
            minOrderRemainingKurus: 36000,
          });
        });

      await patch('/kitchens/me', cook)
        .send({ minOrderKurus: null })
        .expect(200);
    });

    it('should report too few portions with what is left', () =>
      quote(cart({ items: [{ productId: kofteId, quantity: 6 }] }))
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.issues).toEqual([
            { productId: kofteId, kind: 'insufficient_portions', available: 5 },
          ]);
        }));

    it('should block ordering from one’s own kitchen', () =>
      quote(cart(), cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.blockers).toEqual(['own_kitchen']);
        }));

    it('should 404 an unknown kitchen and someone else’s address', async () => {
      await quote(cart({ kitchenId: randomUUID() })).expect(404);

      const cookAddressId = await addAddress(cook, northOf(HOME, 1));
      await quote(
        cart({ fulfillment: 'delivery', addressId: cookAddressId }),
      ).expect(404);
    });

    it('should 422 a malformed cart', () =>
      quote(cart({ items: [{ productId: mantiId, quantity: 21 }] }))
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            expect.objectContaining({ field: 'items.0.quantity' }),
          ]);
        }));
  });

  let orderA: string;
  const keyA = randomUUID();

  describe('place, follow and cancel', () => {
    it('should place the order, take the portions and charge it', async () => {
      const { body } = await placeOrder(
        { ...cart(), note: 'Kapıda arayın', expectedTotalKurus: 33600 },
        keyA,
      ).expect(201);

      expect(body.data).toMatchObject({
        status: 'pending',
        fulfillment: 'pickup',
        totalKurus: 33600,
        note: 'Kapıda arayın',
        kitchenAddress: null,
        estimatedMinutes: 45,
        payment: { status: 'paid' },
        kitchen: { id: kitchenId, cookName: 'Ayşe Y.' },
      });
      expect(body.data.code).toMatch(/^S-[23456789A-HJKMNP-Z]{4}$/);
      expect(body.data.pickupCode).toMatch(/^\d{4}$/);
      expect(body.data.items.map((i: { note: string }) => i.note)).toEqual([
        'Az acılı',
        null,
      ]);
      orderA = body.data.id;

      expect(await portionsOf(kofteId)).toBe(3);
    });

    it('should return the same order for the same Idempotency-Key', async () => {
      const { body } = await placeOrder(
        { ...cart(), expectedTotalKurus: 33600 },
        keyA,
      ).expect(200);

      expect(body.data.id).toBe(orderA);
      expect(await portionsOf(kofteId)).toBe(3);
    });

    it('should answer a stale total with 409 and the new quote', () =>
      placeOrder({ ...cart(), expectedTotalKurus: 30000 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('orderTotalChanged');
          expect(body.data.quote).toMatchObject({
            totalKurus: 33600,
            canOrder: true,
          });
        }));

    it('should require a uuid Idempotency-Key', () =>
      post('/orders', customer)
        .send({ ...cart(), expectedTotalKurus: 33600, acceptedTerms: true })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'idempotencyKey', message: 'mustBeUuid' },
          ]);
        }));

    it('should require accepting the terms', () =>
      placeOrder({ ...cart(), expectedTotalKurus: 33600, acceptedTerms: false })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'acceptedTerms', message: 'mustBeAccepted' },
          ]);
        }));

    it('should refuse what the quote blocks', () =>
      placeOrder({
        ...cart({ fulfillment: 'delivery', addressId: farId }),
        expectedTotalKurus: 33600,
      })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'addressId', message: 'out_of_range' },
          ]);
        }));

    it('should list the order as active, not past', async () => {
      await get('/orders?scope=active', customer)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).toEqual([orderA]);
          expect(body.data.data[0]).toMatchObject({
            kitchen: { id: kitchenId },
            items: [
              { name: 'Mercimek köftesi', quantity: 2 },
              { name: 'Ev mantısı', quantity: 1 },
            ],
            totalKurus: 33600,
          });
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).not.toContain(orderA);
        });
    });

    it('should hide the order from everyone else', () =>
      get(`/orders/${orderA}`, cook).expect(404));

    it('should let the customer cancel while pending and give everything back', async () => {
      await post(`/orders/${orderA}/cancel`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'cancelled',
            cancelledBy: 'customer',
            reason: null,
            payment: { status: 'refunded' },
          });
          expect(body.data.closedAt).toEqual(expect.any(String));
        });

      expect(await portionsOf(kofteId)).toBe(5);

      await post(`/orders/${orderA}/cancel`, customer)
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('orderStatusConflict');
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          expect(ids(body)).toContain(orderA);
        });
    });
  });
});
