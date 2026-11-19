import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureHttp } from './config/configure-http.js';
import { validateEnvironment } from './config/env.validation.js';

async function bootstrap() {
  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  configureHttp(app, app.get(ConfigService));
  app.enableShutdownHooks();
  await app.listen(environment.port);
}
await bootstrap();
