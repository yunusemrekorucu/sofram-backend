import {
  ArgumentsHost,
  ConflictException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

const hostCapturing = () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
};

describe('AllExceptionsFilter', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('should flatten boilerplate validation errors into errors[]', () => {
    const { host, status, json } = hostCapturing();

    new AllExceptionsFilter().catch(
      new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { email: 'notFound', address: { district: 'isNotEmpty' } },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      data: null,
      status: false,
      statusCode: 422,
      message: 'Unprocessable Entity Exception',
      errors: [
        { field: 'email', message: 'notFound' },
        { field: 'address.district', message: 'isNotEmpty' },
      ],
    });
  });

  it('should use the boilerplate `error` key as the message', () => {
    const { host, json } = hostCapturing();

    new AllExceptionsFilter().catch(
      new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: 'notFound',
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      data: null,
      status: false,
      statusCode: 404,
      message: 'notFound',
    });
  });

  it('should pass a client error’s `data` through (409 orderTotalChanged)', () => {
    const { host, json } = hostCapturing();

    new AllExceptionsFilter().catch(
      new ConflictException({
        status: HttpStatus.CONFLICT,
        error: 'orderTotalChanged',
        data: { quote: { totalKurus: 33600 } },
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      data: { quote: { totalKurus: 33600 } },
      status: false,
      statusCode: 409,
      message: 'orderTotalChanged',
    });
  });

  it('should keep Nest default messages', () => {
    const { host, json } = hostCapturing();

    new AllExceptionsFilter().catch(new UnauthorizedException(), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, message: 'Unauthorized' }),
    );
  });

  it('should hide unknown errors behind a generic 500', () => {
    const { host, status, json } = hostCapturing();

    new AllExceptionsFilter().catch(new Error('db password is hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      data: null,
      status: false,
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
