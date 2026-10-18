import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from './constants';

export type Spot = { latitude: number; longitude: number };

// 1×1 PNG; the local file driver accepts .png uploads.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const KM_PER_DEGREE = (Math.PI / 180) * 6371;

export const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '00:00',
  closesAt: '23:59',
}));

export const uniquePhone = (prefix: string) =>
  `${prefix}${String(Date.now()).slice(-7)}`;

/** A fresh spot per run, away from the Kadıköy dev seed and earlier runs. */
export const randomSpot = (): Spot => ({
  latitude: 37 + Math.random(),
  longitude: 30 + Math.random(),
});

export const northOf = (spot: Spot, km: number): Spot => ({
  latitude: spot.latitude + km / KM_PER_DEGREE,
  longitude: spot.longitude,
});

export async function phoneLogin(phoneNumber: string): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/auth/phone/login')
    .send({ idToken: `dev:${phoneNumber}` })
    .expect(200);
  return body.data.token;
}

export async function setName(
  token: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  await request(APP_URL)
    .patch('/api/v1/auth/me')
    .auth(token, { type: 'bearer' })
    .send({ firstName, lastName })
    .expect(200);
}

export async function addAddress(
  token: string,
  spot: Spot,
  fullAddress = 'Teslimat Sk. No:5',
): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/addresses')
    .auth(token, { type: 'bearer' })
    .send({
      title: 'Ev',
      fullAddress,
      district: 'Merkez',
      neighborhood: 'Deneme',
      ...spot,
    })
    .expect(201);
  return body.data.id;
}

/**
 * Opens a kitchen at `spot`, open around the clock, with pickup and delivery:
 * ₺15 up to 2 km, ₺25 up to 5 km, free from ₺300.
 */
export async function openKitchen(token: string, spot: Spot): Promise<string> {
  const addressId = await addAddress(token, spot, 'Deneme Mh. Test Sk. No:1');
  const { body } = await request(APP_URL)
    .post('/api/v1/kitchens/me')
    .auth(token, { type: 'bearer' })
    .send({
      name: 'Sipariş Mutfağı',
      addressId,
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryTiers: [
        { upToKm: 2, feeKurus: 1500 },
        { upToKm: 5, feeKurus: 2500 },
      ],
      freeDeliveryMinKurus: 30000,
      hours: ALL_WEEK,
    })
    .expect(201);
  return body.data.id;
}

export async function categoryId(token: string, slug: string): Promise<string> {
  const { body } = await request(APP_URL)
    .get('/api/v1/categories')
    .auth(token, { type: 'bearer' })
    .expect(200);
  return body.data.find((c: { slug: string }) => c.slug === slug).id;
}

/** Uploads a 1×1 PNG and returns the file id. */
export async function uploadPhoto(token: string): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/files/upload')
    .auth(token, { type: 'bearer' })
    .attach('file', PNG, 'photo.png')
    .expect(201);
  return body.data.file.id;
}

export async function addProduct(
  token: string,
  product: Record<string, unknown>,
): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/kitchens/me/products')
    .auth(token, { type: 'bearer' })
    .send({
      allergens: [],
      dietTags: [],
      photoIds: [await uploadPhoto(token)],
      ...product,
    })
    .expect(201);
  return body.data.id;
}

export async function adminLogin(): Promise<string> {
  const { body } = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    .expect(200);
  return body.data.token;
}

export type Cart = {
  kitchenId: string;
  fulfillment: 'pickup' | 'delivery';
  addressId?: string;
  items: { productId: string; quantity: number }[];
};

export type PlacedOrder = {
  id: string;
  pickupCode: string | null;
  totalKurus: number;
};

/** Quotes the cart and places it at the quoted total. */
export async function placeOrder(
  token: string,
  cart: Cart,
): Promise<PlacedOrder> {
  const quote = await request(APP_URL)
    .post('/api/v1/orders/quote')
    .auth(token, { type: 'bearer' })
    .send(cart)
    .expect(200);
  const { body } = await request(APP_URL)
    .post('/api/v1/orders')
    .auth(token, { type: 'bearer' })
    .set('Idempotency-Key', randomUUID())
    .send({
      ...cart,
      acceptedTerms: true,
      expectedTotalKurus: quote.body.data.totalKurus,
    })
    .expect(201);
  return body.data;
}

export async function cookStep(
  token: string,
  orderId: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<void> {
  await request(APP_URL)
    .post(`/api/v1/kitchens/me/orders/${orderId}/${action}`)
    .auth(token, { type: 'bearer' })
    .send(body)
    .expect(200);
}

/** Places the cart and walks it to `completed` (pickup with the code, delivery via dispatch). */
export async function completeOrder(
  cook: string,
  customer: string,
  cart: Cart,
): Promise<string> {
  const order = await placeOrder(customer, cart);

  for (const action of ['accept', 'start', 'ready']) {
    await cookStep(cook, order.id, action);
  }

  if (cart.fulfillment === 'delivery') {
    await cookStep(cook, order.id, 'dispatch');
    await cookStep(cook, order.id, 'complete');
  } else {
    await cookStep(cook, order.id, 'complete', {
      pickupCode: order.pickupCode,
    });
  }

  return order.id;
}

/** Direct SQL for what the API cannot do on demand (moving the clock). */
export const testDatabase = () =>
  new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
