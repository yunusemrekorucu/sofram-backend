import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Cart,
  addProduct,
  categoryId,
  completeOrder,
  cookStep,
  openKitchen,
  phoneLogin,
  placeOrder,
  randomSpot,
  setName,
  testDatabase,
  uniquePhone,
} from '../utils/orders';

type Card = { id: string } & Record<string, unknown>;

describe('Order chat and trust fields', () => {
  const app = APP_URL;
  const db = testDatabase();
  let cook: string;
  let otherCook: string;
  let customer: string;
  let stranger: string;
  let cart: Cart;
  let orderId: string;
  let firstMessageAt: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const customerUnread = async (id = orderId) =>
    (await get(`/orders/${id}`, customer).expect(200)).body.data
      .unreadMessages as number;
  const cookUnread = async (id = orderId) =>
    (await get(`/kitchens/me/orders/${id}`, cook).expect(200)).body.data
      .unreadMessages as number;

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90573'));
    otherCook = await phoneLogin(uniquePhone('+90574'));
    customer = await phoneLogin(uniquePhone('+90575'));
    stranger = await phoneLogin(uniquePhone('+90576'));
    await setName(customer, 'Deniz', 'Arslan');

    const kitchenId = await openKitchen(cook, randomSpot());
    await openKitchen(otherCook, randomSpot());
    const productId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    cart = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId, quantity: 1 }],
    };

    orderId = (await placeOrder(customer, cart)).id;
    await cookStep(cook, orderId, 'accept');
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('messaging', () => {
    it('should open an empty, writable chat', () =>
      get(`/orders/${orderId}/messages`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({ data: [], canMessage: true });
        }));

    it('should 422 an empty or too long message', async () => {
      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: '   ' })
        .expect(422);
      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: 'x'.repeat(501) })
        .expect(422);
    });

    it('should deliver the customer’s message to the cook as unread', async () => {
      const { body } = await post(`/orders/${orderId}/messages`, customer)
        .send({ body: '  Zili çalmayın, bebek uyuyor  ' })
        .expect(201);
      firstMessageAt = body.data.createdAt;

      expect(body.data).toMatchObject({
        senderRole: 'customer',
        body: 'Zili çalmayın, bebek uyuyor',
      });
      expect(body.data).not.toHaveProperty('senderId');

      expect(await cookUnread()).toBe(1);
      await get('/kitchens/me/orders?tab=preparing', cook)
        .expect(200)
        .expect(({ body: page }) => {
          const card = page.data.data.find((c: Card) => c.id === orderId);
          expect(card.unreadMessages).toBe(1);
        });
      await get('/kitchens/me/orders/summary', cook)
        .expect(200)
        .expect(({ body: summary }) => {
          expect(summary.data.unreadMessages).toBe(1);
        });
    });

    it('should clear the cook’s unread count once the cook reads', async () => {
      await get(`/kitchens/me/orders/${orderId}/messages`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data).toEqual([
            expect.objectContaining({
              senderRole: 'customer',
              body: 'Zili çalmayın, bebek uyuyor',
            }),
          ]);
        });

      expect(await cookUnread()).toBe(0);
      const [row] = await db.query(
        'SELECT "cookLastReadAt", "customerLastReadAt" FROM "order" WHERE "id" = $1',
        [orderId],
      );
      expect((row.cookLastReadAt as Date).getTime()).toBeGreaterThanOrEqual(
        Date.parse(firstMessageAt),
      );
      expect(row.customerLastReadAt).toBeInstanceOf(Date);
    });

    it('should return only newer messages with `after`, oldest first', async () => {
      await post(`/kitchens/me/orders/${orderId}/messages`, cook)
        .send({ body: 'Tamam, kapıdan ararım' })
        .expect(201);
      await post(`/kitchens/me/orders/${orderId}/messages`, cook)
        .send({ body: 'Siparişin hazır' })
        .expect(201);

      expect(await customerUnread()).toBe(2);
      await get('/orders?scope=active', customer)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find((c: Card) => c.id === orderId);
          expect(card.unreadMessages).toBe(2);
        });

      await get(
        `/orders/${orderId}/messages?after=${encodeURIComponent(firstMessageAt)}`,
        customer,
      )
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((m: { body: string }) => m.body)).toEqual([
            'Tamam, kapıdan ararım',
            'Siparişin hazır',
          ]);
        });

      expect(await customerUnread()).toBe(0);
    });

    it('should 422 a malformed `after`', () =>
      get(`/orders/${orderId}/messages?after=yesterday`, customer).expect(422));

    it('should keep everyone else out', async () => {
      await get(`/orders/${orderId}/messages`, stranger).expect(404);
      await post(`/orders/${orderId}/messages`, stranger)
        .send({ body: 'Merhaba' })
        .expect(404);
      await get(`/kitchens/me/orders/${orderId}/messages`, otherCook).expect(
        404,
      );
    });

    it('should go read-only 24 hours after the order closed', async () => {
      await cookStep(cook, orderId, 'start');
      await cookStep(cook, orderId, 'ready');
      const { body } = await get(`/orders/${orderId}`, customer).expect(200);
      await cookStep(cook, orderId, 'complete', {
        pickupCode: body.data.pickupCode,
      });

      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: 'Teşekkürler!' })
        .expect(201);

      await db.query(
        `UPDATE "order" SET "completedAt" = now() - interval '25 hours' WHERE "id" = $1`,
        [orderId],
      );

      await post(`/orders/${orderId}/messages`, customer)
        .send({ body: 'Bir şey daha' })
        .expect(409)
        .expect(({ body: error }) => {
          expect(error.message).toBe('messagingClosed');
        });
      await post(`/kitchens/me/orders/${orderId}/messages`, cook)
        .send({ body: 'Rica ederim' })
        .expect(409);
      await get(`/orders/${orderId}/messages`, customer)
        .expect(200)
        .expect(({ body: chat }) => {
          expect(chat.data.canMessage).toBe(false);
          expect(chat.data.data).toHaveLength(4);
        });
    });
  });

  describe('review and issue on the order screens', () => {
    let completed: string;

    beforeAll(async () => {
      completed = await completeOrder(cook, customer, cart);
    });

    it('should offer a review and a report on a fresh completed order', async () => {
      await get(`/orders/${completed}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            review: null,
            canReview: true,
            issue: null,
            canReportIssue: true,
            unreadMessages: 0,
            canMessage: true,
          });
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find((c: Card) => c.id === completed);
          expect(card).toMatchObject({ canReview: true, unreadMessages: 0 });
        });
    });

    it('should show the review and the open report to both sides', async () => {
      await post(`/orders/${completed}/review`, customer)
        .send({ rating: 5, comment: 'Harika' })
        .expect(201);
      await post(`/orders/${completed}/issues`, customer)
        .send({
          category: 'late',
          description: 'Teslim kodu ekranında 20 dk bekledim.',
          requestedResolution: 'none',
        })
        .expect(201);

      await get(`/orders/${completed}`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            review: { rating: 5, comment: 'Harika', reply: null },
            canReview: false,
            issue: {
              category: 'late',
              status: 'open',
              refundKurus: null,
              adminNote: null,
            },
            canReportIssue: false,
          });
        });

      await get(`/kitchens/me/orders/${completed}`, cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            review: { rating: 5 },
            issue: { category: 'late', status: 'open' },
            canMessage: true,
          });
          expect(body.data.issue).not.toHaveProperty('description');
        });

      await get('/orders?scope=past', customer)
        .expect(200)
        .expect(({ body }) => {
          const card = body.data.data.find((c: Card) => c.id === completed);
          expect(card.canReview).toBe(false);
        });
    });

    it('should sum up the rating and unreplied reviews for the cook', () =>
      get('/kitchens/me/orders/summary', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            rating: { avg: 5, count: 1 },
            unrepliedReviews: 1,
            unreadMessages: 1,
          });
        }));
  });
});
