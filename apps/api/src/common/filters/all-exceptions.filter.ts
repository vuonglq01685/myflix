import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiErrorBody, ERROR_HTTP_STATUS, ErrorCode } from '@myflix/shared';

/** Thrown by services when a documented business rule blocks the request. */
export class BusinessError extends HttpException {
  constructor(
    readonly errorCode: ErrorCode,
    message: string,
  ) {
    super(message, ERROR_HTTP_STATUS[errorCode]);
  }
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body: ApiErrorBody = {
      statusCode: status,
      errorCode: resolveErrorCode(exception, status),
      message: resolveMessage(exception, status),
      correlationId: String(req.id ?? ''),
      timestamp: new Date().toISOString(),
    };

    // Detail stays server-side; the client only ever sees the envelope.
    if (status >= 500) this.logger.error({ err: exception, correlationId: body.correlationId });

    res.status(status).json(body);
  }
}

function resolveErrorCode(exception: unknown, status: number): ApiErrorBody['errorCode'] {
  if (exception instanceof BusinessError) return exception.errorCode;
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  return 'INTERNAL_ERROR';
}

function resolveMessage(exception: unknown, status: number): string {
  if (status >= 500) return 'Đã có lỗi xảy ra, vui lòng thử lại';
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
  }
  return 'Yêu cầu không hợp lệ';
}
