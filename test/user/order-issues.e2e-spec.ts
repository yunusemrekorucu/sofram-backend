import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL, MAIL_HOST, MAIL_PORT } from '../utils/constants';
import {
  Cart,
  addAddress,
  addProduct,
  adminLogin,
  categoryId,
  completeOrder,
  cookStep,
  northOf,
  openKitchen,
  phoneLogin,
  placeOrder,
  randomSpot,
  testDatabase,
  uniquePhone,
} from '../utils/orders';
import { MailMessage } from '../utils/types/mail-message.type';

describe('Order issues', () => {
  const app = APP_URL;
  const mail = `http://${MAIL_HOST}:${MAIL_PORT}`;
  const db = testDatabase();
  const HOME = randomSpot();
  let cook: string;
  let customer: string;
  let stranger: string;
  let admin: string;
  let pickup: Cart;
  let orderA: string;
  let issueA: string;
  let cancelledIssue: string;

  const post = (path: string, token: string) =>
    request(app).post(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const patch = (path: string, token: string) =>
    request(app).patch(`/api/v1${path}`).auth(token, { type: 'bearer' });
  const get = (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).auth(token, { type: 'bearer' });

  const report = (orderId: string, overrides: Record<string, unknown> = {}) =>
    post(`/orders/${orderId}/issues`, customer).send({
      category: 'missing_item',
      description: 'Sütlaç paketten çıkmadı.',
      requestedResolution: 'refund_partial',
      ...overrides,
    });

  /** What the refunds wrote on the payment row. */
  const storedPayment = async (orderId: string) => {
    const [row] = await db.query(
      'SELECT "status", "amountKurus", "refundedKurus" FROM "payment" WHERE "orderId" = $1',
      [orderId],
    );
    return row as {
      status: string;
      amountKurus: number;
      refundedKurus: number;
    };
  };

  beforeAll(async () => {
    await db.initialize();
    cook = await phoneLogin(uniquePhone('+90570'));
    customer = await phoneLogin(uniquePhone('+90571'));
    stranger = await phoneLogin(uniquePhone('+90572'));
    admin = await adminLogin();

    const kitchenId = await openKitchen(cook, HOME);
    const productId = await addProduct(cook, {
      categoryId: await categoryId(cook, 'main-dish'),
      name: 'Ev mantısı',
      priceKurus: 14000,
      saleType: 'on_demand',
      prepMinutes: 45,
    });
    pickup = {
      kitchenId,
      fulfillment: 'pickup',
      items: [{ productId, quantity: 1 }],
    };
    orderA = await completeOrder(cook, customer, pickup);
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('reporting', () => {
    it('should 422 a short description, an unknown category and too many photos', () =>
      report(orderA, {
        category: 'cold_food',
        description: ' kısa ',
        requestedResolution: 'money',
        photoIds: [1, 2, 3, 4],
      })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors.map((e: { field: string }) => e.field)).toEqual(
            expect.arrayContaining([
              'category',
              'description',
              'requestedResolution',
              'photoIds',
            ]),
          );
        }));

    it('should 404 someone else’s order', () =>
      post(`/orders/${orderA}/issues`, stranger)
        .send({
          category: 'late',
          description: 'Sipariş çok geç geldi.',
          requestedResolution: 'none',
        })
        .expect(404));

    it('should open a report on a completed order and mail support', async () => {
      const { body } = await report(orderA).expect(201);
      issueA = body.data.id;

      expect(body.data).toMatchObject({
        category: 'missing_item',
        description: 'Sütlaç paketten çıkmadı.',
        requestedResolution: 'refund_partial',
        status: 'open',
        refundKurus: null,
        adminNote: null,
        photos: [],
      });

      const { body: inbox } = await request(mail).get('/email').expect(200);
      const sent = (inbox as MailMessage[]).find(
        (message) =>
          message.to[0].address === process.env.SUPPORT_EMAIL &&
          message.text.includes(issueA),
      );
      expect(sent?.text).toContain('missing_item');
    });

    it('should refuse a second open report', () =>
      report(orderA)
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('issueNotAllowed');
        }));

    it('should refuse an order that is still being prepared', async () => {
      const order = await placeOrder(customer, pickup);
      await cookStep(cook, order.id, 'accept');

      await report(order.id).expect(409);

      await cookStep(cook, order.id, 'cancel', { reason: 'too_busy' });
      const { body } = await report(order.id, { category: 'other' }).expect(
        201,
      );
      cancelledIssue = body.data.id;
    });

    it('should accept a delivery stuck on the way for more than two hours', async () => {
      const addressId = await addAddress(customer, northOf(HOME, 1));
      const order = await placeOrder(customer, {
        ...pickup,
        fulfillment: 'delivery',
        addressId,
      });
      for (const action of ['accept', 'start', 'ready', 'dispatch']) {
        await cookStep(cook, order.id, action);
      }

      await report(order.id, { category: 'late' }).expect(409);

      await db.query(
        `UPDATE "order" SET "onTheWayAt" = now() - interval '3 hours' WHERE "id" = $1`,
        [order.id],
      );
      await report(order.id, { category: 'late' }).expect(201);
    });

    it('should close 48 hours after completion', async () => {
      const late = await completeOrder(cook, customer, pickup);
      await db.query(
        `UPDATE "order" SET "completedAt" = now() - interval '49 hours' WHERE "id" = $1`,
        [late],
      );

      await report(late).expect(409);
    });
  });

  describe('the admin', () => {
    it('should keep the desk to admins', async () => {
      await get('/admin/issues', customer).expect(403);
      await patch(`/admin/issues/${issueA}`, cook)
        .send({ status: 'rejected' })
        .expect(403);
    });

    it('should list open reports with their order', () =>
      get('/admin/issues?status=open&limit=50', admin)
        .expect(200)
        .expect(({ body }) => {
          const issue = body.data.data.find(
            (i: { id: string }) => i.id === issueA,
          );
          expect(issue).toMatchObject({
            status: 'open',
            order: { id: orderA, totalKurus: 14700 },
          });
          expect(issue.order.code).toMatch(/^S-/);
        }));

    it('should 422 a refund on a rejection and a non-positive refund', async () => {
      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'rejected', refundKurus: 100 })
        .expect(422)
        .expect(({ body }) => {
          expect(body.errors).toEqual([
            { field: 'refundKurus', message: 'onlyWhenResolved' },
          ]);
        });

      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'resolved', refundKurus: 0 })
        .expect(422);
    });

    it('should resolve with a partial refund that stays paid', async () => {
      await patch(`/admin/issues/${issueA}`, admin)
        .send({
          status: 'resolved',
          refundKurus: 5000,
          adminNote: 'Sütlaç ücreti iade edildi',
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            status: 'resolved',
            refundKurus: 5000,
            adminNote: 'Sütlaç ücreti iade edildi',
          });
          expect(body.data.resolvedAt).toEqual(expect.any(String));
        });

      expect(await storedPayment(orderA)).toEqual({
        status: 'paid',
        amountKurus: 14700,
        refundedKurus: 5000,
      });

      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'rejected' })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('issueClosed');
        });
    });

    it('should not refund twice when a closed issue is decided again', async () => {
      await patch(`/admin/issues/${issueA}`, admin)
        .send({ status: 'resolved', refundKurus: 5000 })
        .expect(409)
        .expect(({ body }) => {
          expect(body.message).toBe('issueClosed');
        });

      expect((await storedPayment(orderA)).refundedKurus).toBe(5000);
    });

    it('should cap the refunds at what was paid and keep the report open', async () => {
      const { body } = await report(orderA, {
        category: 'quality_hygiene',
        requestedResolution: 'refund_full',
      }).expect(201);

      await patch(`/admin/issues/${body.data.id}`, admin)
        .send({ status: 'resolved', refundKurus: 9701 })
        .expect(422)
        .expect(({ body: error }) => {
          expect(error.errors).toEqual([
            { field: 'refundKurus', message: 'exceedsPaid' },
          ]);
        });

      expect((await storedPayment(orderA)).refundedKurus).toBe(5000);

      await patch(`/admin/issues/${body.data.id}`, admin)
        .send({ status: 'resolved', refundKurus: 9700 })
        .expect(200);

      expect(await storedPayment(orderA)).toEqual({
        status: 'refunded',
        amountKurus: 14700,
        refundedKurus: 14700,
      });
    });

    it('should 422 any refund on an order that was refunded in full', async () => {
      await patch(`/admin/issues/${cancelledIssue}`, admin)
        .send({ status: 'resolved', refundKurus: 100 })
        .expect(422);

      await patch(`/admin/issues/${cancelledIssue}`, admin)
        .send({ status: 'resolved', adminNote: 'Ödeme zaten iade edildi' })
        .expect(200);
    });
  });
});
