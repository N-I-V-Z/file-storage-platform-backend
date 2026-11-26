import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { RedisService } from './../src/infrastructure/redis/redis.service.js';
import { PrismaService } from './../src/infrastructure/database/prisma.service.js';
import { ApiKeysRepository } from './../src/modules/api-keys/api-keys.repository.js';
import { configureHttp } from './../src/config/configure-http.js';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { QuotasRepository } from './../src/modules/quotas/quotas.repository.js';
import { ProjectsService } from './../src/modules/projects/projects.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  it('reserves quota atomically across concurrent uploads', async () => {
    const email = `quota-${randomUUID()}@example.com`;
    const prisma = app.get(PrismaService);
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const auth = `Bearer ${login.body.data.accessToken as string}`;
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const project = await prisma.project.create({
        data: { ownerId: user.id, name: 'Quota test', quotaBytes: 100n },
      });
      const quota = app.get(QuotasRepository);
      const uploads = [randomUUID(), randomUUID()];
      const results = await Promise.all(
        uploads.map((id) =>
          quota.reserve({
            id,
            projectId: project.id,
            storageKey: randomUUID(),
            originalName: 'file.pdf',
            contentType: 'application/pdf',
            reservationBytes: 60n,
          }),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const accepted = results.find(Boolean);
      expect(accepted).toBeDefined();
      expect(accepted!.expiresAt.getTime()).toBeGreaterThan(
        Date.now() +
          app.get(ConfigService).getOrThrow<number>('uploadTimeoutMs') +
          9 * 60_000,
      );
      await quota.finalize(accepted!.id, 40n, 'a'.repeat(64), new Date());
      const updated = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(updated.usedBytes).toBe(40n);
      expect(updated.reservedBytes).toBe(0n);
      const usagePath = `/api/v1/projects/${project.id}/usage`;
      const finalizedUsage = await request(app.getHttpServer())
        .get(usagePath)
        .set('Authorization', auth)
        .expect(200);
      expect(finalizedUsage.body).toMatchObject({
        success: true,
        data: {
          projectId: project.id,
          quotaBytes: '100',
          usedBytes: '40',
          reservedBytes: '0',
        },
      });
      await expect(
        app.get(ProjectsService).remove(user.id, project.id),
      ).rejects.toMatchObject({ status: 409 });
      const abandonedId = randomUUID();
      await quota.reserve({
        id: abandonedId,
        projectId: project.id,
        storageKey: randomUUID(),
        originalName: 'aborted.pdf',
        contentType: 'application/pdf',
        reservationBytes: 60n,
      });
      const pendingUsage = await request(app.getHttpServer())
        .get(usagePath)
        .set('Authorization', auth)
        .expect(200);
      expect(pendingUsage.body.data).toMatchObject({
        usedBytes: '40',
        reservedBytes: '60',
      });
      expect(await quota.markAbandoned(abandonedId)).toBe(true);
      expect(await quota.releaseAbandoned(abandonedId)).toBe(true);
      expect(await quota.releaseAbandoned(abandonedId)).toBe(false);
      const afterRelease = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(afterRelease.usedBytes).toBe(40n);
      expect(afterRelease.reservedBytes).toBe(0n);
      const releasedUsage = await request(app.getHttpServer())
        .get(usagePath)
        .set('Authorization', auth)
        .expect(200);
      expect(releasedUsage.body.data.reservedBytes).toBe('0');
    } finally {
      await prisma.storedFile.deleteMany({
        where: { project: { owner: { email } } },
      });
      await prisma.user.deleteMany({ where: { email } });
    }
  });

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
      expect(response.body).toMatchObject({
        success: true,
        data: { email },
        timestamp: expect.any(String),
      });
      expect(response.body.data).toMatchObject({ email });
      expect(response.body.data.id).toEqual(expect.any(String));
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
      expect(response.body).toMatchObject({
        success: true,
        data: { user: { email }, accessToken: expect.any(String) },
        timestamp: expect.any(String),
      });
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.user).toMatchObject({ email });
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

  it('rotates refresh tokens and revokes a session on replay', async () => {
    const email = `refresh-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const originalCookie = String(login.headers['set-cookie']).split(';')[0];

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(200);
      const rotatedCookie = String(refreshed.headers['set-cookie']).split(
        ';',
      )[0];
      expect(rotatedCookie).not.toBe(originalCookie);
      expect(refreshed.body.data.accessToken).toEqual(expect.any(String));

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', originalCookie)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', rotatedCookie)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .expect(401);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('revokes a session when an older refresh token is replayed', async () => {
    const email = `older-replay-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const firstCookie = String(login.headers['set-cookie']).split(';')[0];
      const firstRotation = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(200);
      const secondCookie = String(firstRotation.headers['set-cookie']).split(
        ';',
      )[0];
      const secondRotation = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', secondCookie)
        .expect(200);
      const thirdCookie = String(secondRotation.headers['set-cookie']).split(
        ';',
      )[0];

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', thirdCookie)
        .expect(401);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('rejects refresh without a cookie', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
  });

  it('rejects a refresh request from an untrusted browser origin', async () => {
    const email = `origin-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .set('Origin', 'https://untrusted.example')
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .expect(200);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('does not revoke a session for an unrelated invalid token', async () => {
    const email = `invalid-refresh-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const invalidCookie = `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', invalidCookie)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('rejects an expired refresh session', async () => {
    const email = `expired-refresh-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const user = await app.get(PrismaService).user.findUniqueOrThrow({
        where: { email },
        include: { sessions: true },
      });
      await app.get(PrismaService).session.update({
        where: { id: user.sessions[0].id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('protects account details and revokes tokens on logout', async () => {
    const email = `account-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(401);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const accessToken = login.body.data.accessToken as string;
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((response) =>
          expect(response.body.data).toMatchObject({ email }),
        );
      const [header, payload, signature] = accessToken.split('.');
      const tamperedToken = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', cookie)
        .expect(204);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
      await request(app.getHttpServer()).get('/health').expect(200);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('limits repeated sign-in attempts', async () => {
    const email = `limit-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      for (let attempt = 0; attempt < 5; attempt++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(429);
      await request(app.getHttpServer()).get('/health').expect(200);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('creates and isolates projects by owner', async () => {
    const ownerEmail = `project-owner-${randomUUID()}@example.com`;
    const otherEmail = `project-other-${randomUUID()}@example.com`;
    try {
      for (const email of [ownerEmail, otherEmail]) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email, password: 'long-test-password' })
          .expect(201);
      }
      const ownerLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ownerEmail, password: 'long-test-password' })
        .expect(200);
      const otherLogin = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: otherEmail, password: 'long-test-password' })
        .expect(200);
      const ownerAuth = `Bearer ${ownerLogin.body.data.accessToken as string}`;
      const otherAuth = `Bearer ${otherLogin.body.data.accessToken as string}`;

      await request(app.getHttpServer())
        .post('/api/v1/projects')
        .send({ name: 'Private files' })
        .expect(401);
      const created = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', ownerAuth)
        .send({ name: '  Private files  ' })
        .expect(201);
      expect(created.body).toMatchObject({
        success: true,
        data: { name: 'Private files' },
        timestamp: expect.any(String),
      });
      const projectId = created.body.data.id as string;
      expect(created.body.data).toMatchObject({ name: 'Private files' });
      expect(created.body.data).not.toHaveProperty('ownerId');
      expect(created.body.data).not.toHaveProperty('quotaBytes');
      const usagePath = `/api/v1/projects/${projectId}/usage`;
      await request(app.getHttpServer()).get(usagePath).expect(401);
      await request(app.getHttpServer())
        .get(usagePath)
        .set('Authorization', otherAuth)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${randomUUID()}/usage`)
        .set('Authorization', ownerAuth)
        .expect(404);
      await request(app.getHttpServer())
        .get('/api/v1/projects/not-a-uuid/usage')
        .set('Authorization', ownerAuth)
        .expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', ownerAuth)
        .expect(200)
        .expect((response) => expect(response.body.data).toHaveLength(1));
      await request(app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', otherAuth)
        .expect(200)
        .expect((response) => expect(response.body.data).toEqual([]));
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}`)
        .set('Authorization', otherAuth)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${projectId}`)
        .set('Authorization', otherAuth)
        .send({ name: 'Stolen' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${projectId}`)
        .set('Authorization', ownerAuth)
        .send({ name: 'Updated files' })
        .expect(200)
        .expect((response) =>
          expect(response.body.data.name).toBe('Updated files'),
        );
      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${projectId}`)
        .set('Authorization', ownerAuth)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}`)
        .set('Authorization', ownerAuth)
        .expect(404);
    } finally {
      await app.get(PrismaService).user.deleteMany({
        where: { email: { in: [ownerEmail, otherEmail] } },
      });
    }
  });

  it('issues and revokes API keys without returning stored secrets', async () => {
    const email = `key-owner-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const auth = `Bearer ${login.body.data.accessToken as string}`;
      const first = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', auth)
        .send({ name: 'First' })
        .expect(201);
      const projectId = first.body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/api-keys`)
        .send({ name: 'No auth', scopes: ['projects:read'] })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/api-keys`)
        .set('Authorization', auth)
        .send({ name: 'Invalid', scopes: ['files:admin'] })
        .expect(400);
      const created = await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/api-keys`)
        .set('Authorization', auth)
        .send({ name: 'Reader', scopes: ['projects:read', 'files:read'] })
        .expect(201);
      expect(created.body).toMatchObject({
        success: true,
        data: { name: 'Reader', token: expect.any(String) },
        timestamp: expect.any(String),
      });
      const keyId = created.body.data.id as string;
      const token = created.body.data.token as string;
      expect(token).toMatch(/^fsp_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/);
      const stored = await app
        .get(PrismaService)
        .apiKey.findUniqueOrThrow({ where: { id: keyId } });
      expect(stored.tokenHash).not.toContain(token);
      const listed = await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/api-keys`)
        .set('Authorization', auth)
        .expect(200);
      expect(listed.body.data).toHaveLength(1);
      expect(JSON.stringify(listed.body)).not.toContain(token);
      expect(JSON.stringify(listed.body)).not.toContain(stored.tokenHash);

      const revokeResponse = await request(app.getHttpServer())
        .delete(`/api/v1/projects/${projectId}/api-keys/${keyId}`)
        .set('Authorization', auth)
        .expect(204);
      expect(revokeResponse.text).toBe('');
      const revoked = await app
        .get(PrismaService)
        .apiKey.findUniqueOrThrow({ where: { id: keyId } });
      expect(revoked.revokedAt).not.toBeNull();
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('authenticates API keys within their project and scope', async () => {
    const email = `key-access-${randomUUID()}@example.com`;
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'long-test-password' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'long-test-password' })
        .expect(200);
      const auth = `Bearer ${login.body.data.accessToken as string}`;
      const projects = [];
      for (const name of ['First', 'Second']) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/projects')
          .set('Authorization', auth)
          .send({ name })
          .expect(201);
        projects.push(response.body.data.id as string);
      }
      const [projectId, otherId] = projects;
      const reader = await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/api-keys`)
        .set('Authorization', auth)
        .send({ name: 'Reader', scopes: ['projects:read'] })
        .expect(201);
      const token = reader.body.data.token as string;
      const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .set('Authorization', `ApiKey ${forged}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/v1/projects')
        .set('Authorization', `ApiKey ${token}`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .set('Authorization', `ApiKey ${token}`)
        .expect(200)
        .expect((response) => expect(response.body.data.id).toBe(projectId));
      const used = await app.get(PrismaService).apiKey.findUniqueOrThrow({
        where: { id: reader.body.data.id as string },
      });
      expect(used.lastUsedAt).not.toBeNull();
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${otherId}/key-access`)
        .set('Authorization', `ApiKey ${token}`)
        .expect(403);
      await request(app.getHttpServer())
        .delete(
          `/api/v1/projects/${projectId}/api-keys/${reader.body.data.id as string}`,
        )
        .set('Authorization', auth)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .set('Authorization', `ApiKey ${token}`)
        .expect(401);

      const writer = await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/api-keys`)
        .set('Authorization', auth)
        .send({ name: 'Writer', scopes: ['files:write'] })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .set('Authorization', `ApiKey ${writer.body.data.token as string}`)
        .expect(403);
      await app.get(PrismaService).apiKey.update({
        where: { id: writer.body.data.id as string },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .set('Authorization', `ApiKey ${writer.body.data.token as string}`)
        .expect(401);
    } finally {
      await app.get(PrismaService).user.deleteMany({ where: { email } });
    }
  });

  it('limits repeated invalid API key verification attempts', async () => {
    const projectId = randomUUID();
    const token = `fsp_${randomUUID()}_${'A'.repeat(43)}`;
    const lookups = vi.spyOn(app.get(ApiKeysRepository), 'findForVerification');
    for (let attempt = 0; attempt < 20; attempt++) {
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${projectId}/key-access`)
        .set('Authorization', `ApiKey ${token}`)
        .expect(401);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/key-access`)
      .set('Authorization', `ApiKey ${token}`)
      .expect(429);
    expect(lookups).toHaveBeenCalledTimes(20);
  });

  afterEach(async () => {
    await app.close();
  });
});
