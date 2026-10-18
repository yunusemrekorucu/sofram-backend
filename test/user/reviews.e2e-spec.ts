import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Cart,
  addProduct,
  adminLogin,
  categoryId,
  completeOrder,
  openKitchen,
  phoneLogin,
  placeOrder,
  randomSpot,
  setName,
  testDatabase,
  uniquePhone,
  uploadPhoto,
} from '../utils/orders';

describe('Reviews', () => {
  const app = APP_URL;
  const db = testDatabase();
  let cook: string;
  let otherCook: string;
  let customer: string;
  let stranger: string;
  let admin: string;
  let kitchenId: string;
  let cart: Cart;
  let orderA: string;
  let orderB: string;
  let reviewA: string;
  let reviewB: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const put = (path: string, token: string) =>
    request(app).put(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token: string) =>
    request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const del = (path: string, token: string) =>
    request(app).delete(`/api/v1${path}`).auth(token, { type: 'bearer' });

  /** What the review transactions wrote on the kitchen row. */
  const storedRating = async () => {
    const [row] = await db.query(
      'SELECT "ratingAvg", "ratingCount" FROM "kitchen" WHERE "id" = $1',
      [kitchenId],
    );
    return row as { ratingAvg: number | null; ratingCount: number };
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90563'));
    otherCook = await phoneLogin(uniquePhone('+90564'));
    customer = await phoneLogin(uniquePhone('+90565'));
    stranger = await phoneLogin(uniquePhone('+90566'));
    admin = await adminLogin();
    await setName(cook, 'Ayşe', 'Yılmaz');
    await setName(customer, 'Deniz', 'Arslan');

    kitchenId = await openKitchen(cook, randomSpot());
    await openKitchen(otherCook, randomSpot());
    const mantiId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    cart = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId: mantiId, quantity: 1 }],
    };

    orderA = await completeOrder(cook, customer, cart);
    orderB = await completeOrder(cook, customer, cart);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('writing', () => {
    it('should 409 reviewNotAllowed before the order is completed', async () => {
      const pending = await placeOrder(customer, cart);

      await post(`/orders/${pending.id}/review`, customer)
        .send({ rating: 5 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewNotAllowed');
        });

      await post(`/orders/${pending.id}/cancel`, customer).expect(200);
    });

    it('should 422 bad stars, too many tags and unknown photos', () =>
      post(`/orders/${orderA}/review`, customer)
        .send({
          rating: 6,
          taste: 0,
          tags: ['homemade', 'on_time', 'arrived_hot', 'friendly_cook'],
          comment: 'x'.repeat(501),
          photoIds: ['not-a-uuid'],
        })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors.map((e: { field: string }) => e.field)).toEqual(
            expect.arrayContaining([
              'rating',
              'taste',
              'tags',
              'comment',
              'photoIds',
            ]),
          );
        }));

    it('should 404 someone else’s order', () =>
      post(`/orders/${orderA}/review`, stranger)
        .send({ rating: 5 })
        .expect(404));

    it('should review a completed order and rate the kitchen in the same write', async () => {
      const photoId = await uploadPhoto(customer);

      const { body } = await post(`/orders/${orderA}/review`, customer)
        .send({
          rating: 5,
          taste: 5,
          tags: ['homemade', 'arrived_hot'],
          comment: '  Annemin mantısı gibi  ',
          photoIds: [photoId],
        })
        .expect(201);
      reviewA = body.data.id;

      expect(body.data).toMatchObject({
        rating: 5,
        taste: 5,
        portion: null,
        tags: ['homemade', 'arrived_hot'],
        comment: 'Annemin mantısı gibi',
        photos: [{ id: photoId }],
        reply: null,
      });
      expect(await storedRating()).toEqual({ ratingAvg: 5, ratingCount: 1 });
    });

    it('should 409 reviewExists the second time', () =>
      post(`/orders/${orderA}/review`, customer)
        .send({ rating: 1 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewExists');
        }));

    it('should average two reviews to one decimal', async () => {
      const { body } = await post(`/orders/${orderB}/review`, customer)
        .send({ rating: 4, tags: ['homemade'] })
        .expect(201);
      reviewB = body.data.id;

      expect(await storedRating()).toEqual({ ratingAvg: 4.5, ratingCount: 2 });
    });

    it('should close 7 days after completion', async () => {
      const late = await completeOrder(cook, customer, cart);
      await db.query(
        `UPDATE "order" SET "completedAt" = now() - interval '7 days 1 minute' WHERE "id" = $1`,
        [late],
      );

      await post(`/orders/${late}/review`, customer)
        .send({ rating: 5 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewNotAllowed');
        });
    });
  });

  describe('reading', () => {
    it('should list visible reviews newest first with the summary', () =>
      get(`/discover/kitchens/${kitchenId}/reviews`, stranger)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
            reviewB,
            reviewA,
          ]);
          expect(body.data.data[1]).toMatchObject({
            authorName: 'Deniz A.',
            comment: 'Annemin mantısı gibi',
          });
          expect(body.data.data[1]).not.toHaveProperty('authorId');
          expect(body.data.hasNextPage).toBe(false);
          expect(body.data.summary).toEqual({
            ratingAvg: 4.5,
            ratingCount: 2,
            distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
            topTags: ['homemade', 'arrived_hot'],
          });
        }));

    it('should page the list', () =>
      get(`/discover/kitchens/${kitchenId}/reviews?page=1&limit=1`, stranger)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data).toHaveLength(1);
          expect(body.data.hasNextPage).toBe(true);
        }));
  });

  describe('the cook', () => {
    it('should list unreplied reviews, reply, edit and delete the reply', async () => {
      await get('/kitchens/me/reviews?filter=unreplied', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data).toHaveLength(2);
          expect(body.data.data[0]).toMatchObject({
            id: reviewB,
            orderId: orderB,
            isHidden: false,
          });
        });

      await put(`/kitchens/me/reviews/${reviewA}/reply`, cook)
        .send({ reply: '  ' })
        .expect(422);

      await put(`/kitchens/me/reviews/${reviewA}/reply`, cook)
        .send({ reply: 'Afiyet olsun!' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({ reply: 'Afiyet olsun!' });
          expect(body.data.repliedAt).toEqual(expect.any(String));
        });

      await put(`/kitchens/me/reviews/${reviewA}/reply`, cook)
        .send({ reply: 'Afiyet olsun, yine bekleriz!' })
        .expect(200);

      await get(`/discover/kitchens/${kitchenId}/reviews`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data[1].reply).toBe('Afiyet olsun, yine bekleriz!');
        });

      await get('/kitchens/me/reviews?filter=unreplied', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
            reviewB,
          ]);
        });

      await del(`/kitchens/me/reviews/${reviewB}/reply`, cook).expect(204);
    });

    it('should keep another cook out', async () => {
      await put(`/kitchens/me/reviews/${reviewA}/reply`, otherCook)
        .send({ reply: 'Hey' })
        .expect(404);
      await post(`/kitchens/me/reviews/${reviewA}/report`, otherCook)
        .send({ reason: 'other' })
        .expect(404);
      await get('/kitchens/me/reviews', customer).expect(404);
    });

    it('should report a review once', async () => {
      await post(`/kitchens/me/reviews/${reviewB}/report`, cook)
        .send({ reason: 'nonsense' })
        .expect(422);

      await post(`/kitchens/me/reviews/${reviewB}/report`, cook)
        .send({ reason: 'false_claim', note: 'Porsiyon tamdı' })
        .expect(204);

      await post(`/kitchens/me/reviews/${reviewB}/report`, cook)
        .send({ reason: 'other' })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewAlreadyReported');
        });
    });
  });

  describe('the admin', () => {
    it('should keep moderation to admins', async () => {
      await get('/admin/review-reports', cook).expect(403);
      await patch(`/admin/reviews/${reviewB}`, cook)
        .send({ isHidden: true })
        .expect(403);
    });

    it('should list the report', () =>
      get('/admin/review-reports?limit=50', admin)
        .expect(200)
        .expect(({ body }) => {
          const report = body.data.data.find(
            (r: { review: { id: string } }) => r.review.id === reviewB,
          );
          expect(report).toMatchObject({
            reason: 'false_claim',
            note: 'Porsiyon tamdı',
            review: { id: reviewB, kitchenId, isHidden: false },
          });
        }));

    it('should hide a review from the list and the rating, then show it again', async () => {
      await patch(`/admin/reviews/${reviewB}`, admin)
        .send({ isHidden: true })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.isHidden).toBe(true);
        });

      expect(await storedRating()).toEqual({ ratingAvg: 5, ratingCount: 1 });

      await patch('/kitchens/me', cook)
        .send({ description: 'Ev yemekleri, taze ve sıcak' })
        .expect(200);
      expect(await storedRating()).toEqual({ ratingAvg: 5, ratingCount: 1 });

      await get(`/discover/kitchens/${kitchenId}/reviews`, customer)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
            reviewA,
          ]);
          expect(body.data.summary.ratingCount).toBe(1);
        });

      await get('/kitchens/me/reviews', cook)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.data[0]).toMatchObject({
            id: reviewB,
            isHidden: true,
          });
        });

      await patch(`/admin/reviews/${reviewB}`, admin)
        .send({ isHidden: false })
        .expect(200);

      expect(await storedRating()).toEqual({ ratingAvg: 4.5, ratingCount: 2 });
    });
  });

  describe('deleting', () => {
    it('should let only the author delete, recompute and never allow a second review', async () => {
      await del(`/reviews/${reviewA}`, stranger).expect(404);
      await del(`/reviews/${reviewA}`, customer).expect(204);

      expect(await storedRating()).toEqual({ ratingAvg: 4, ratingCount: 1 });

      await post(`/orders/${orderA}/review`, customer)
        .send({ rating: 5 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('reviewExists');
        });

      await del(`/reviews/${reviewA}`, customer).expect(404);
    });

    it('should 404 the reviews of an unknown kitchen', () =>
      get(
        '/discover/kitchens/00000000-0000-4000-8000-000000000000/reviews',
        customer,
      ).expect(404));
  });
});
