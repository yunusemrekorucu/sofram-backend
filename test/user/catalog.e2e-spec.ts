import { beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

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

  let categoryId: string;
  let soupId: string;
  let mantiId: string;
  let kofteId: string;

  it('should list the seeded categories with both names', () =>
    request(app)
      .get('/api/v1/categories')
      .auth(customer, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.length).toBeGreaterThanOrEqual(8);
        expect(body.data[0]).toEqual(
          expect.objectContaining({
            nameTr: expect.any(String),
            nameEn: expect.any(String),
          }),
        );
        categoryId = body.data.find(
          (c: { slug: string }) => c.slug === 'main-dish',
        ).id;
        soupId = body.data.find((c: { slug: string }) => c.slug === 'soup').id;
      }));

  it('should keep category writes to admins', async () => {
    await request(app)
      .post('/api/v1/categories')
      .auth(customer, { type: 'bearer' })
      .send({ slug: `e2e-${Date.now()}`, nameTr: 'Test', nameEn: 'Test' })
      .expect(403);

    const { body } = await request(app)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    await request(app)
      .post('/api/v1/categories')
      .auth(body.data.token, { type: 'bearer' })
      .send({
        slug: `e2e-${Date.now()}`,
        nameTr: 'Test',
        nameEn: 'Test',
        isActive: false,
      })
      .expect(201)
      .expect(({ body: created }) => {
        expect(created.data.isActive).toBe(false);
      });
  });

  it('should require the field that belongs to the sale type', async () =>
    request(app)
      .post('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Mercimek Köftesi',
        priceKurus: 9000,
        saleType: 'daily_portion',
        allergens: [],
        dietTags: ['vegan'],
        photoIds: [await uploadPng(cook)],
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body.errors).toEqual([
          { field: 'portionsAvailable', message: 'required' },
        ]);
      }));

  it('should add an on-demand product and clear the other sale field', async () => {
    const photoIds = [await uploadPng(cook), await uploadPng(cook)];

    const { body } = await request(app)
      .post('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Ev Usulü MANTI',
        description: 'Yoğurtlu',
        priceKurus: 14000,
        saleType: 'on_demand',
        prepMinutes: 45,
        portionsAvailable: 10,
        allergens: ['milk', 'gluten'],
        dietTags: [],
        photoIds,
      })
      .expect(201);

    expect(body.data).toMatchObject({
      saleType: 'on_demand',
      prepMinutes: 45,
      portionsAvailable: null,
      isActive: true,
      kitchenId,
      category: { id: categoryId },
    });
    expect(body.data.photos.map((p: { id: string }) => p.id)).toEqual(photoIds);
    expect(body.data).not.toHaveProperty('searchText');
    mantiId = body.data.id;
  });

  it('should add a daily-portion product', async () => {
    const { body } = await request(app)
      .post('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .send({
        categoryId,
        name: 'Mercimek Köftesi',
        priceKurus: 9000,
        saleType: 'daily_portion',
        portionsAvailable: 3,
        allergens: [],
        dietTags: ['vegan'],
        photoIds: [await uploadPng(cook)],
      })
      .expect(201);

    expect(body.data).toMatchObject({
      prepMinutes: null,
      portionsAvailable: 3,
    });
    kofteId = body.data.id;
  });

  it('should list the cook’s products, newest first', () =>
    request(app)
      .get('/api/v1/kitchens/me/products')
      .auth(cook, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.map((p: { id: string }) => p.id)).toEqual([
          kofteId,
          mantiId,
        ]);
      }));

  it('should switch the sale type back and forth', async () => {
    await request(app)
      .patch(`/api/v1/kitchens/me/products/${mantiId}`)
      .auth(cook, { type: 'bearer' })
      .send({ saleType: 'daily_portion', portionsAvailable: 5 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          prepMinutes: null,
          portionsAvailable: 5,
        });
      });

    await request(app)
      .patch(`/api/v1/kitchens/me/products/${mantiId}`)
      .auth(cook, { type: 'bearer' })
      .send({ saleType: 'on_demand', prepMinutes: 45 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          prepMinutes: 45,
          portionsAvailable: null,
        });
      });
  });

  it('should 404 product writes from someone else', () =>
    request(app)
      .patch(`/api/v1/kitchens/me/products/${mantiId}`)
      .auth(customer, { type: 'bearer' })
      .send({ priceKurus: 1 })
      .expect(404));

  const discover = (
    path: string,
    token: string,
    query: Record<string, unknown>,
  ) =>
    request(app)
      .get(`/api/v1/discover/${path}`)
      .auth(token, { type: 'bearer' })
      .query(query);

  const ids = (body: { data: { data: { id: string }[] } }) =>
    body.data.data.map((item) => item.id);

  type Card = { id: string } & Record<string, unknown>;
  const find = (body: { data: { data: Card[] } }, id: string) =>
    body.data.data.find((item) => item.id === id);

  it('should list nearby products with their kitchen', () =>
    discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toEqual(expect.arrayContaining([mantiId, kofteId]));
        expect(find(body, mantiId)).toMatchObject({
          priceKurus: 14000,
          photo: { id: expect.any(String) },
          allergenWarnings: [],
          kitchen: { id: kitchenId },
        });
        expect(
          (find(body, mantiId)?.kitchen as { distanceKm: number }).distanceKm,
        ).toBeLessThanOrEqual(0.1);
        expect(find(body, mantiId)).not.toHaveProperty('searchText');
      }));

  it('should hide kitchens beyond both delivery and pickup range', () =>
    discover('products', customer, north(30))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(mantiId);
      }));

  it('should price delivery by tier and round the coordinates', () =>
    discover('kitchens', customer, north(3))
      .expect(200)
      .expect(({ body }) => {
        const kitchen = find(body, kitchenId);
        expect(kitchen).toMatchObject({
          deliveryAvailable: true,
          deliveryFeeKurus: 2500,
          pickupAvailable: true,
          latitude: Number(HOME.latitude.toFixed(3)),
        });
        expect(kitchen?.distanceKm).toBeCloseTo(3, 0);
        expect(kitchen).not.toHaveProperty('fullAddress');
      }));

  it('should search with folded Turkish text', async () => {
    await discover('products', customer, { ...north(0), q: 'manti' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(mantiId);
        expect(ids(body)).not.toContain(kofteId);
      });

    await discover('products', customer, { ...north(0), q: 'KÖFTE' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kofteId);
      });

    await discover('kitchens', customer, { ...north(0), q: 'köfte' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kitchenId);
      });
  });

  it('should filter by diet and category', async () => {
    await discover('products', customer, { ...north(0), diet: 'vegetarian' })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kofteId);
        expect(ids(body)).not.toContain(mantiId);
      });

    await discover('kitchens', customer, { ...north(0), categoryId: soupId })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(kitchenId);
      });
  });

  it('should honour allergen preferences', async () => {
    await request(app)
      .patch('/api/v1/auth/me')
      .auth(customer, { type: 'bearer' })
      .send({ allergenPreferences: ['milk'] })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.allergenPreferences).toEqual(['milk']);
      });

    await discover('products', customer, { ...north(0), allergenSafe: true })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(mantiId);
        expect(ids(body)).toContain(kofteId);
      });

    await discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(find(body, mantiId)?.allergenWarnings).toEqual(['milk']);
      });
  });

  it('should reject an unknown allergen preference', () =>
    request(app)
      .patch('/api/v1/auth/me')
      .auth(customer, { type: 'bearer' })
      .send({ allergenPreferences: ['peanut'] })
      .expect(422));

  it('should show the kitchen menu grouped by category', () =>
    discover(`kitchens/${kitchenId}`, customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: kitchenId,
          description: 'Ev yemekleri',
          hours: ALL_WEEK,
        });
        expect(body.data.sections).toHaveLength(1);
        expect(body.data.sections[0].category.id).toBe(categoryId);
        expect(
          body.data.sections[0].products.map((p: { id: string }) => p.id),
        ).toEqual([mantiId, kofteId]);
      }));

  it('should show product detail with every photo', () =>
    discover(`products/${mantiId}`, customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.photos).toHaveLength(2);
        expect(body.data).toMatchObject({
          description: 'Yoğurtlu',
          kitchen: { id: kitchenId, deliveryFeeKurus: 0 },
        });
      }));

  it('should drop sold-out daily portions', async () => {
    await request(app)
      .patch(`/api/v1/kitchens/me/products/${kofteId}`)
      .auth(cook, { type: 'bearer' })
      .send({ portionsAvailable: 0 })
      .expect(200);

    await discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(kofteId);
      });

    await discover(`products/${kofteId}`, customer, north(0)).expect(404);

    // Only the milk-containing manti is left; allergenSafe filters products,
    // never kitchens.
    await discover('kitchens', customer, { ...north(0), allergenSafe: true })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).toContain(kitchenId);
      });

    await discover('products', customer, { ...north(0), allergenSafe: true })
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(kofteId);
        expect(ids(body)).not.toContain(mantiId);
      });
  });

  it('should keep a paused kitchen listed but closed', async () => {
    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: true })
      .expect(200);

    await discover('kitchens', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(find(body, kitchenId)).toMatchObject({
          isPaused: true,
          isOpenNow: false,
          opensAt: null,
        });
      });

    await request(app)
      .patch('/api/v1/kitchens/me')
      .auth(cook, { type: 'bearer' })
      .send({ isPaused: false })
      .expect(200);
  });

  it('should open a far-away kitchen only for its owner', async () => {
    await discover(`kitchens/${kitchenId}`, customer, north(30)).expect(404);
    await discover(`kitchens/${kitchenId}`, cook, north(30)).expect(200);
  });

  it('should take the menu down when the cook deletes the account', async () => {
    await request(app)
      .delete('/api/v1/auth/me')
      .auth(cook, { type: 'bearer' })
      .expect(204);

    await discover('products', customer, north(0))
      .expect(200)
      .expect(({ body }) => {
        expect(ids(body)).not.toContain(mantiId);
      });

    await discover(`kitchens/${kitchenId}`, customer, north(0)).expect(404);
    await discover(`products/${mantiId}`, customer, north(0)).expect(404);
  });
});
