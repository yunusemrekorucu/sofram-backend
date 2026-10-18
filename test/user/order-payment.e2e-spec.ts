import { beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  addProduct,
  categoryId,
  openKitchen,
  phoneLogin,
  randomSpot,
  uniquePhone,
} from '../utils/orders';

/**
 * Needs an API started with DEV_PAYMENT_FAIL=true (see the plan's final
 * verification); skipped against the normal dev API.
 */
const describeWhenDeclining =
  process.env.DEV_PAYMENT_FAIL === 'true' ? describe : describe.skip;

describeWhenDeclining('Orders: declined payment', () => {
  const app = APP_URL;
  let cook: string;
  let customer: string;
  let kitchenId: string;
  let kofteId: string;

  const portions = async (): Promise<number> => {
    const { body } = await request(app)
      .get('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .expect(200);
    return body.data.find((p: { id: string }) => p.id === kofteId)
      .portionsAvailable;
  };

  beforeAll(async () => {
    cook = await phoneLogin(uniquePhone('+90564'));
    customer = await phoneLogin(uniquePhone('+90565'));
    kitchenId = await openKitchen(cook, randomSpot());
    kofteId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Mercimek köftesi',
      priceKurus: 9000,
      saleType: 'daily_portion',
      portionsAvailable: 5,
    });
  });

  it('should answer 402 paymentFailed and roll the order back', async () => {
    const key = randomUUID();
    const order = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId: kofteId, quantity: 2 }],
      expectedTotalKurus: 18900,
      acceptedTerms: true,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app)
        .post('/api/v1/orders')
        .auth(customer, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(order)
        .expect(402)
        .expect(({ body }) => {
          expect(body.message).toBe('paymentFailed');
        });
    }

    expect(await portions()).toBe(5);

    await request(app)
      .get('/api/v1/orders?scope=active')
      .auth(customer, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.data).toEqual([]);
      });
  });
});
