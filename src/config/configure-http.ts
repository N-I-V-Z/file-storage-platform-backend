import { randomUUID } from 'node:crypto';
import {
  INestApplication,
  RequestMethod,
  VersioningType,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { NextFunction, Request, Response } from 'express';
import { ValidatedEnvironment } from './env.validation.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

export function configureHttp(
  app: INestApplication,
  config: ConfigService<ValidatedEnvironment, true>,
): void {
  app.use(helmet());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('x-request-id', randomUUID());
    next();
  });
  app.enableCors({ origin: config.getOrThrow('corsOrigins') });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/', method: RequestMethod.ALL },
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('File Storage Platform API')
      .setVersion('1')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
