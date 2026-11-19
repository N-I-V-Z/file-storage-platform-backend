import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiResponseInterceptor } from './api-response.interceptor.js';

it('keeps streamed file responses unwrapped', async () => {
  const file = new StreamableFile(Buffer.from('file bytes'));
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: '/api/v1/files/id' }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
  const next = { handle: () => of(file) } as CallHandler;

  const result = await firstValueFrom(
    new ApiResponseInterceptor().intercept(context, next),
  );
  expect(result).toBe(file);
});
