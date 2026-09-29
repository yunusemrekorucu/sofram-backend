import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiEnvelope } from './api-response.type';
import { ErrorTree, flattenErrors } from './flatten-errors';

type HttpErrorBody = {
  message?: string | string[];
  error?: string;
  errors?: ErrorTree;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const statusCode = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiEnvelope<null> = {
      data: null,
      status: false,
      statusCode,
      message:
        isHttp && statusCode < 500
          ? this.messageOf(exception)
          : 'Internal server error',
    };

    const errors = isHttp ? this.bodyOf(exception).errors : undefined;
    if (errors) {
      body.errors = flattenErrors(errors);
    }

    response.status(statusCode).json(body);
  }

  private bodyOf(exception: HttpException): HttpErrorBody {
    const raw = exception.getResponse();
    return typeof raw === 'string' ? { message: raw } : (raw as HttpErrorBody);
  }

  private messageOf(exception: HttpException): string {
    const { message, error } = this.bodyOf(exception);

    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof error === 'string') return error;
    return exception.message;
  }
}
