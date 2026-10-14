import { beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';

// 1×1 PNG; the local file driver accepts .png uploads.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const uniquePhone = (prefix: string) =>
  `${prefix}${String(Date.now()).slice(-7)}`;

const phoneLogin = async (phoneNumber: string): Promise<string> => {
  const { body } = await request(APP_URL)
    .post('/api/v1/auth/phone/login')
    .send({ idToken: `dev:${phoneNumber}` })
    .expect(200);
  return body.data.token;
};

const uploadPng = async (token: string): Promise<string> => {
  const { body } = await request(APP_URL)
    .post('/api/v1/files/upload')
    .auth(token, { type: 'bearer' })
    .attach('file', PNG, 'dish.png')
    .expect(201);
  return body.data.file.id;
};

// A fresh spot per run, away from the Kadıköy dev seed and earlier runs.
const HOME = { latitude: 37 + Math.random(), longitude: 30 + Math.random() };

/** Discovery query params `km` kilometres north of HOME. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used by the Task 6 discovery specs
const north = (km: number) => ({
  lat: HOME.latitude + km / 111.19,
  lng: HOME.longitude,
});

const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
  dayOfWeek,
  opensAt: '00:00',
  closesAt: '23:59',
}));

describe('Catalog: kitchens, products and discovery', () => {
  const app = APP_URL;
  let cook: string;
  let customer: string;
  let addressId: string;
  let coverId: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by the Task 5 product specs
  let kitchenId: string;

  const kitchenBody = () => ({
    name: 'Test Mutfağı',
    description: 'Ev yemekleri',
    coverPhotoId: coverId,
    addressId,
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryTiers: [
      { upToKm: 2, feeKurus: 0 },
      { upToKm: 5, feeKurus: 2500 },
    ],
    hours: ALL_WEEK,
  });

  beforeAll(async () => {
    cook = await phoneLogin(uniquePhone('+90556'));
    customer = await phoneLogin(uniquePhone('+90557'));
  });

  it('should 404 /kitchens/me before the kitchen exists', () =>
    request(app)
      .get('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .expect(404));

  it('should report hasKitchen: false', () =>
    request(app)
      .get('/api/v1/auth/me')
      .auth(cook, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.hasKitchen).toBe(false);
      }));

  it('should prepare an address and a cover photo', async () => {
    const { body } = await request(app)
      .post('/api/v1/addresses')
      .auth(cook, { type: 'bearer' })
      .send({
        title: 'Ev',
        fullAddress: 'Deneme Mh. Test Sk. No:1',
        district: 'Merkez',
        neighborhood: 'Deneme',
        ...HOME,
      })
      .expect(201);
    addressId = body.data.id;
    coverId = await uploadPng(cook);
  });

  it('should reject cross-field kitchen rules with dotted field errors', () =>
    request(app)
      .post('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({
        ...kitchenBody(),
        deliveryTiers: [
          { upToKm: 3, feeKurus: 0 },
          { upToKm: 2, feeKurus: 1000 },
        ],
        hours: [
          { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
          { dayOfWeek: 1, opensAt: '13:00', closesAt: '15:00' },
        ],
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body.errors).toEqual(
          expect.arrayContaining([
            { field: 'deliveryTiers.1.upToKm', message: 'mustIncrease' },
            { field: 'hours.1.opensAt', message: 'overlaps' },
          ]),
        );
      }));

  it('should open the kitchen with a copy of the address', () =>
    request(app)
      .post('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send(kitchenBody())
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          name: 'Test Mutfağı',
          district: 'Merkez',
          latitude: HOME.latitude,
          longitude: HOME.longitude,
          isPaused: false,
          isVerified: false,
          coverPhoto: { id: coverId },
        });
        expect(body.data.coverPhoto.path).toMatch(/^https?:\/\//);
        expect(body.data).not.toHaveProperty('searchText');
        expect(body.data).not.toHaveProperty('deliveryRadiusKm');
        expect(body.data).not.toHaveProperty('ownerId');
        kitchenId = body.data.id;
      }));

  it('should refuse a second kitchen', () =>
    request(app)
      .post('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send(kitchenBody())
      .expect(409));

  it('should pause and resume the kitchen', async () => {
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          isPaused: true,
          name: 'Test Mutfağı',
        });
      });

    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: false })
      .expect(200);
  });

  it('should reject an explicit null for a required field', () =>
    request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ name: null })
      .expect(422));

  it('should report hasKitchen: true', () =>
    request(app)
      .get('/api/v1/auth/me')
      .auth(cook, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.hasKitchen).toBe(true);
      }));

  it('should 404 kitchen edits from a user without a kitchen', () =>
    request(app)
      .patch('/api/v1/kitchens/me')
      .auth(customer, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(404));

  // TASK-5-PRODUCTS
  // TASK-6-DISCOVERY
});
