import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  Cart,
  addProduct,
  categoryId,
  completeOrder,
  openKitchen,
  phoneLogin,
  randomSpot,
  setName,
  testDatabase,
  uniquePhone,
  uploadPhoto,
} from '../utils/orders';

describe('Account deletion of trust data', () => {
  const app = APP_URL;
  const db = testDatabase();
  let cook: string;
  let leaving: string;
  let staying: string;
  let leavingId: number;
  let kitchenId: string;
  let cart: Cart;
  let leavingOrder: string;
  let stayingReview: string;
  let issueId: string;

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const deleteAccount = (token: string) =>
    request(app).delete('/api/v1/auth/me').auth(token, { type: 'bearer' });

  const storedRating = async () => {
    const [row] = await db.query(
      'SELECT "ratingAvg", "ratingCount" FROM "kitchen" WHERE "id" = $1',
      [kitchenId],
    );
    return row as { ratingAvg: number | null; ratingCount: number };
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90577'));
    leaving = await phoneLogin(uniquePhone('+90578'));
    staying = await phoneLogin(uniquePhone('+90579'));
    await setName(leaving, 'Gidecek', 'Müşteri');
    await setName(staying, 'Kalacak', 'Müşteri');
    leavingId = (await get('/auth/me', leaving).expect(200)).body.data.id;

    kitchenId = await openKitchen(cook, randomSpot());
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

    leavingOrder = await completeOrder(cook, leaving, cart);
    const second = await completeOrder(cook, leaving, cart);
    const stayingOrder = await completeOrder(cook, staying, cart);

    await post(`/orders/${leavingOrder}/review`, leaving)
      .send({
        rating: 5,
        comment: 'Kişisel bir yorum',
        photoIds: [await uploadPhoto(leaving)],
      })
      .expect(201);
    await post(`/orders/${second}/review`, leaving)
      .send({ rating: 1 })
      .expect(201);
    stayingReview = (
      await post(`/orders/${stayingOrder}/review`, staying)
        .send({ rating: 4, comment: 'Güzeldi' })
        .expect(201)
    ).body.data.id;

    await post(`/kitchens/${kitchenId}/favorite`, leaving).expect(204);
    await post(`/orders/${leavingOrder}/messages`, leaving)
      .send({ body: 'Benim mesajım' })
      .expect(201);
    await post(`/kitchens/me/orders/${leavingOrder}/messages`, cook)
      .send({ body: 'Aşçının mesajı' })
      .expect(201);
    issueId = (
      await post(`/orders/${leavingOrder}/issues`, leaving)
        .send({
          category: 'missing_item',
          description: 'Bir kalem eksik geldi.',
          requestedResolution: 'none',
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('should start from three counted reviews', async () => {
    expect(await storedRating()).toEqual({ ratingAvg: 3.3, ratingCount: 3 });
  });

  it('should scrub the customer’s reviews, recompute, drop favorites and messages, keep the issue', async () => {
    await deleteAccount(leaving).expect(204);

    expect(await storedRating()).toEqual({ ratingAvg: 4, ratingCount: 1 });

    const reviews = await db.query(
      'SELECT "deletedAt", "comment", "photos" FROM "review" WHERE "authorId" = $1',
      [leavingId],
    );
    expect(reviews).toHaveLength(2);
    for (const review of reviews) {
      expect(review.deletedAt).toBeInstanceOf(Date);
      expect(review.comment).toBeNull();
      expect(review.photos).toEqual([]);
    }

    const [{ favorites }] = await db.query(
      'SELECT COUNT(*)::int AS favorites FROM "favorite" WHERE "userId" = $1',
      [leavingId],
    );
    expect(favorites).toBe(0);

    const messages = await db.query(
      'SELECT "senderRole", "body" FROM "order_message" WHERE "orderId" = $1',
      [leavingOrder],
    );
    expect(messages).toEqual([{ senderRole: 'cook', body: 'Aşçının mesajı' }]);

    const [issue] = await db.query(
      'SELECT "status", "description" FROM "order_issue" WHERE "id" = $1',
      [issueId],
    );
    expect(issue).toEqual({
      status: 'open',
      description: 'Bir kalem eksik geldi.',
    });

    await get(`/discover/kitchens/${kitchenId}/reviews`, staying)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data.map((r: { id: string }) => r.id)).toEqual([
          stayingReview,
        ]);
      });
  });

  it('should take the kitchen’s reviews and replies with the cook’s account', async () => {
    await request(app)
      .put(`/api/v1/kitchens/me/reviews/${stayingReview}/reply`)
      .auth(cook, { type: 'bearer' })
      .send({ reply: 'Teşekkürler!' })
      .expect(200);

    await deleteAccount(cook).expect(204);

    const [review] = await db.query(
      'SELECT "deletedAt", "reply", "repliedAt" FROM "review" WHERE "id" = $1',
      [stayingReview],
    );
    expect(review.deletedAt).toBeInstanceOf(Date);
    expect(review.reply).toBeNull();
    expect(review.repliedAt).toBeNull();
    expect(await storedRating()).toEqual({ ratingAvg: null, ratingCount: 0 });

    await get(`/discover/kitchens/${kitchenId}/reviews`, staying).expect(404);
  });
});
