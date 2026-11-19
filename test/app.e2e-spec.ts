import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { RedisService } from './../src/infrastructure/redis/redis.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET) stays live', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/ready (GET) checks PostgreSQL and Redis', () => {
    return request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect({ status: 'ok', services: { postgres: 'up', redis: 'up' } });
  });

  it('/ready (GET) reports a failed dependency without exposing its error', async () => {
    vi.spyOn(app.get(RedisService), 'ping').mockRejectedValue(
      new Error('private connection detail'),
    );

    await request(app.getHttpServer())
      .get('/ready')
      .expect(503)
      .expect({
        status: 'unavailable',
        services: { postgres: 'up', redis: 'down' },
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
