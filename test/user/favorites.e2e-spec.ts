import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Spot,
  addProduct,
  categoryId,
  completeOrder,
  northOf,
  openKitchen,
  phoneLogin,
  randomSpot,
  testDatabase,
  uniquePhone,
} from '../utils/orders';

type Card = { id: string } & Record<string, unknown>;

describe('Favorites and kitchen ratings', () => {
  const app = APP_URL;
  const db = testDatabase();
  const HOME: Spot = randomSpot();
  const near = northOf(HOME, 1);
  const point = `lat=${near.latitude}&lng=${near.longitude}`;
  let cook: string;
  let secondCook: string;
  let customer: string;
  let kitchenId: string;
  let secondKitchenId: string;
  let mantiId: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const del = (path: string, token: string) =>
    request(app).delete(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const favoriteIds = async (): Promise<string[]> => {
    const { body } = await get(`/favorites?${point}`, customer).expect(200);
    return body.data.data.map((card: Card) => card.id);
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90567'));
    secondCook = await phoneLogin(uniquePhone('+90568'));
    customer = await phoneLogin(uniquePhone('+90569'));

    kitchenId = await openKitchen(cook, HOME);
    secondKitchenId = await openKitchen(secondCook, northOf(HOME, 2));
    mantiId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should add a favorite once however often it is sent', async () => {
    await post(`/kitchens/${kitchenId}/favorite`, customer).expect(204);
    await post(`/kitchens/${kitchenId}/favorite`, customer).expect(204);

    const [{ count }] = await db.query(
      `SELECT COUNT(*)::int AS count FROM "favorite" f
       JOIN "kitchen" k ON k."id" = f."kitchenId"
       WHERE k."id" = $1`,
      [kitchenId],
    );
    expect(count).toBe(1);
  });

  it('should 404 an unknown kitchen', () =>
    post(
      '/kitchens/00000000-0000-4000-8000-000000000000/favorite',
      customer,
    ).expect(404));

  it('should list favorites as kitchen cards, newest first', async () => {
    await post(`/kitchens/${secondKitchenId}/favorite`, customer).expect(204);

    await get(`/favorites?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data.map((card: Card) => card.id)).toEqual([
          secondKitchenId,
          kitchenId,
        ]);
        expect(body.data.data[1]).toMatchObject({
          name: 'Sipariş Mutfağı',
          isFavorite: true,
          isOpenNow: true,
          ratingAvg: null,
          ratingCount: 0,
          pickupAvailable: true,
        });
        expect(body.data.data[1].distanceKm).toBeCloseTo(1, 0);
        expect(body.data.data[1]).not.toHaveProperty('fullAddress');
        expect(body.data.hasNextPage).toBe(false);
      });
  });

  it('should show the heart on discovery cards and the detail', async () => {
    await get(`/discover/kitchens?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        const mine = body.data.data.find((card: Card) => card.id === kitchenId);
        expect(mine).toMatchObject({ isFavorite: true, ratingCount: 0 });
      });

    await get(`/discover/kitchens/${kitchenId}?${point}`, cook)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.isFavorite).toBe(false);
      });
  });

  it('should keep a paused kitchen in the list', async () => {
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(200);

    await get(`/favorites?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        const card = body.data.data.find((c: Card) => c.id === kitchenId);
        expect(card).toMatchObject({ isPaused: true, isOpenNow: false });
      });

    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: false })
      .expect(200);
  });

  it('should rate the kitchen on discovery once it is reviewed', async () => {
    const orderId = await completeOrder(cook, customer, {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId: mantiId, quantity: 1 }],
    });
    await post(`/orders/${orderId}/review`, customer)
      .send({ rating: 4 })
      .expect(201);

    await get(`/discover/kitchens/${kitchenId}?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      });

    await get(`/discover/products?${point}`, customer)
      .expect(200)
      .expect(({ body }) => {
        const dish = body.data.data.find((p: Card) => p.id === mantiId);
        expect(dish.kitchen).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      });

    // PATCH /kitchens/me leaves the rating to the review writes.
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ description: 'Ev yemekleri' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      });
  });

  it('should remove a favorite once however often it is sent', async () => {
    await del(`/kitchens/${kitchenId}/favorite`, customer).expect(204);
    await del(`/kitchens/${kitchenId}/favorite`, customer).expect(204);

    expect(await favoriteIds()).toEqual([secondKitchenId]);
  });

  it('should drop a deleted kitchen from the list', async () => {
    await request(app)
      .delete('/api/v1/auth/me')
      .auth(secondCook, { type: 'bearer' })
      .expect(204);

    expect(await favoriteIds()).toEqual([]);
    await post(`/kitchens/${secondKitchenId}/favorite`, customer).expect(404);
  });
});
