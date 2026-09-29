import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { APP_URL } from '../utils/constants';

describe('Phone auth, profile and addresses', () => {
  const app = APP_URL;
  const phone = `+90555${String(Date.now()).slice(-7)}`;
  let token: string;
  let refreshToken: string;
  let homeId: string;
  let workId: string;

  const login = () =>
    request(app)
      .post('/api/v1/auth/phone/login')
      .send({ idToken: `dev:${phone}` });

  const address = (title: string, extra: Record<string, unknown> = {}) => ({
    title,
    fullAddress: 'Caferağa Mh. Moda Cd. No:1',
    district: 'Kadıköy',
    neighborhood: 'Caferağa',
    latitude: 40.9862,
    longitude: 29.0254,
    ...extra,
  });

  it('should reject a malformed phone token with a field error', () =>
    request(app)
      .post('/api/v1/auth/phone/login')
      .send({ idToken: 'nope' })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: false,
          statusCode: 422,
          errors: [{ field: 'idToken', message: 'invalidPhoneToken' }],
        });
      }));

  it('should create a nameless user on first login', () =>
    login()
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe(true);
        expect(body.data.isNewUser).toBe(true);
        expect(body.data.user).toMatchObject({
          phoneNumber: phone,
          profileCompleted: false,
        });
        expect(body.data.user.kvkkAcceptedAt).toBeUndefined();
        token = body.data.token;
        refreshToken = body.data.refreshToken;
      }));

  it('should log the same number in as an existing user', () =>
    login()
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.isNewUser).toBe(false);
      }));

  it('should complete the profile with KVKK consent', () =>
    request(app)
      .patch('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .send({
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        kvkkAccepted: true,
        marketingConsent: false,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          firstName: 'Ayşe',
          profileCompleted: true,
          marketingConsent: false,
        });
      }));

  it('should reject an invalid address with dot-path errors', () =>
    request(app)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send(address('', { latitude: 200 }))
      .expect(422)
      .expect(({ body }) => {
        const fields = body.errors.map((e: { field: string }) => e.field);
        expect(fields).toEqual(expect.arrayContaining(['title', 'latitude']));
      }));

  it('should make the first address the default', () =>
    request(app)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send(address('Ev'))
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ title: 'Ev', isDefault: true });
        expect(body.data.user).toBeUndefined();
        homeId = body.data.id;
      }));

  it('should move the default when a new address asks for it', async () => {
    const created = await request(app)
      .post('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .send(address('İş', { isDefault: true, floor: '4' }))
      .expect(201);
    workId = created.body.data.id;

    const { body } = await request(app)
      .get('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .expect(200);

    expect(body.data.map((a: { id: string }) => a.id)).toEqual([
      workId,
      homeId,
    ]);
    expect(body.data[0].isDefault).toBe(true);
    expect(body.data[1].isDefault).toBe(false);
  });

  it('should answer 404 for an address that is not mine', () =>
    request(app)
      .patch('/api/v1/addresses/00000000-0000-4000-8000-000000000000')
      .auth(token, { type: 'bearer' })
      .send({ title: 'x' })
      .expect(404));

  it('should promote the remaining address when the default is deleted', async () => {
    await request(app)
      .delete(`/api/v1/addresses/${workId}`)
      .auth(token, { type: 'bearer' })
      .expect(204);

    const { body } = await request(app)
      .get('/api/v1/addresses')
      .auth(token, { type: 'bearer' })
      .expect(200);

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: homeId, isDefault: true });
  });

  it('should refresh the session', () =>
    request(app)
      .post('/api/v1/auth/refresh')
      .auth(refreshToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.token).toBeDefined();
        token = body.data.token;
        refreshToken = body.data.refreshToken;
      }));

  it('should delete the account and lock the old tokens out', async () => {
    await request(app)
      .delete('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(204);

    await request(app)
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(401);

    await request(app)
      .post('/api/v1/auth/refresh')
      .auth(refreshToken, { type: 'bearer' })
      .expect(401);
  });

  it('should let the same number start over as a new user', () =>
    login()
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.isNewUser).toBe(true);
        expect(body.data.user.profileCompleted).toBe(false);
      }));
});
