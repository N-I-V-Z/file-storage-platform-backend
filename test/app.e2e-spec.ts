import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { RedisService } from './../src/infrastructure/redis/redis.service.js';
import { PrismaService } from './../src/infrastructure/database/prisma.service.js';
import { configureHttp } from './../src/config/configure-http.js';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttp(app, app.get(ConfigService));
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

  it('sets request ID, security headers and allowed CORS origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3000')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });

  it('serves the API specification', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(response.body.info.title).toBe('File Storage Platform API');
  });

  it('does not grant CORS to an unlisted origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://unlisted.example')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps health probes outside the versioned API', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health?token=private')
      .expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', details: [] },
      path: '/api/v1/health',
    });
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain('private');
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

    const response = await request(app.getHttpServer())
      .get('/ready')
      .expect(503);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        details: [{ postgres: 'up', redis: 'down' }],
      },
      path: '/ready',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'private connection detail',
    );
  });

  it('/ready (GET) reports PostgreSQL as down', async () => {
    vi.spyOn(app.get(PrismaService), '$queryRaw').mockRejectedValue(
      new Error('private database detail'),
    );

    const response = await request(app.getHttpServer())
      .get('/ready')
      .expect(503);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        details: [{ postgres: 'down', redis: 'up' }],
      },
      path: '/ready',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'private database detail',
    );
  });

  it('registers a normalized account without exposing its password hash', async () => {
    const email = `register-${randomUUID()}@example.com`;
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `  ${email.toUpperCase()}  `,
          password: 'long-test-password',
        })
        .expect(201);
      expect(response.body).toMatchObject({ email });
      expect(response.body.id).toEqual(expect.any(String));
      expect(JSON.stringify(response.body)).not.toContain('password');
      const stored = await app.get(PrismaService).user.findUnique({
        where: { email },
      });
      expect(stored?.passwordHash).not.toBe('long-test-password');
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('rejects invalid registration input', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'bad', password: 'short', extra: 'unexpected' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `unknown-${randomUUID()}@example.com`,
        password: 'long-test-password',
        role: 'admin',
      })
      .expect(400);
  });

  it('rejects duplicate account email', async () => {
    const email = `duplicate-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: email.toUpperCase(), password: 'long-test-password' })
        .expect(409);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('signs in with a protected refresh cookie and hashed session token', async () => {
    const email = `login-${randomUUID()}@example.com`;
    const password = 'long-test-password';
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({ email });
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('fsp_refresh=');
      expect(cookie).toContain('HttpOnly');
      const user = await app.get(PrismaService).user.findUniqueOrThrow({
        where: { email },
        include: { sessions: true },
      });
      expect(user.sessions).toHaveLength(1);
      expect(cookie).not.toContain(user.sessions[0].refreshTokenHash);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('rejects login for an unknown email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `missing-${randomUUID()}@example.com`,
        password: 'long-test-password',
      })
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
