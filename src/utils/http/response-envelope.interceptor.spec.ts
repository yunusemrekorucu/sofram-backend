import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

const contextWithStatus = (statusCode: number) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
  }) as unknown as ExecutionContext;

const handlerReturning = (value: unknown): CallHandler => ({
  handle: () => of(value),
});

const run = (statusCode: number, body: unknown) =>
  lastValueFrom(
    new ResponseEnvelopeInterceptor().intercept(
      contextWithStatus(statusCode),
      handlerReturning(body),
    ),
  );

describe('ResponseEnvelopeInterceptor', () => {
  it('should wrap the body with status metadata', async () => {
    await expect(run(200, { id: 1 })).resolves.toEqual({
      data: { id: 1 },
      status: true,
      statusCode: 200,
      message: 'OK',
    });
  });

  it('should keep the handler status code (201 for POST)', async () => {
    await expect(run(201, { id: 'a' })).resolves.toMatchObject({
      statusCode: 201,
    });
  });

  it('should turn an empty body into data: null', async () => {
    await expect(run(200, undefined)).resolves.toMatchObject({ data: null });
  });

  it('should not wrap 204 responses', async () => {
    await expect(run(204, undefined)).resolves.toBeUndefined();
  });
});
