import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, map } from 'rxjs';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const path = request.originalUrl.split('?')[0];
    if (!/^\/api\/v\d+\//.test(path) || response.statusCode === 204)
      return next.handle();

    return next.handle().pipe(
      map((data: unknown) =>
        data instanceof StreamableFile
          ? data
          : {
              success: true,
              data,
              timestamp: new Date().toISOString(),
            },
      ),
    );
  }
}
