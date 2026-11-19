import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const services =
      payload &&
      typeof payload === 'object' &&
      'services' in payload &&
      typeof payload.services === 'object'
        ? payload.services
        : undefined;

    response.status(status).json({
      success: false,
      error: {
        code: HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR',
        message:
          status >= 500
            ? status === HttpStatus.SERVICE_UNAVAILABLE
              ? 'Service unavailable'
              : 'Internal server error'
            : status === HttpStatus.NOT_FOUND
              ? 'Not Found'
              : exception instanceof HttpException
                ? exception.message
                : 'Request failed',
        details: services ? [services] : [],
      },
      path: request.originalUrl.split('?')[0],
      timestamp: new Date().toISOString(),
    });
  }
}
