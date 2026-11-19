import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { validateEnvironment } from './config/env.validation.js';

async function bootstrap() {
  const environment = validateEnvironment(process.env);
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.enableShutdownHooks();
  await app.listen(environment.port);
}
await bootstrap();
