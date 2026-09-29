import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import { ApiEnvelope } from './api-response.type';

/**
 * Registered FIRST in main.ts so it is the outermost interceptor: it sees the
 * body after ClassSerializerInterceptor has applied @Exclude/@Expose groups.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (response.statusCode === Number(HttpStatus.NO_CONTENT)) {
          return body;
        }

        const envelope: ApiEnvelope<unknown> = {
          data: body ?? null,
          status: true,
          statusCode: response.statusCode,
          message: 'OK',
        };

        return envelope;
      }),
    );
  }
}
