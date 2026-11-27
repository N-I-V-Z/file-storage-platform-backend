import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';

describe('admin reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userAuth: string;
  const projectIds: string[] = [];
  const email = `admin-report-${randomUUID()}@example.com`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    prisma = app.get(PrismaService);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'long-test-password' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'long-test-password' })
      .expect(200);
    userAuth = `Bearer ${login.body.data.accessToken as string}`;
  });

  afterAll(async () => {
    if (!app) return;
    if (prisma) {
      if (projectIds.length) {
        await prisma.auditEvent.deleteMany({
          where: { projectId: { in: projectIds } },
        });
      }
      await prisma.user.deleteMany({ where: { email } });
    }
    await app.close();
  });

  it('denies anonymous users and regular accounts', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operations')
      .set('Authorization', userAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .set('Authorization', userAuth)
      .expect(403);
    const jwt = app.get(JwtService);
    const secret = app.get(ConfigService).getOrThrow<string>('jwtAccessSecret');
    const verified = await jwt.verifyAsync<{
      sub: string;
      sid: string;
      typ: string;
    }>(userAuth.slice(7), {
      secret,
      issuer: 'file-storage-platform',
      audience: 'file-storage-web',
    });
    const roleClaimToken = await jwt.signAsync(
      { sub: verified.sub, sid: verified.sid, typ: 'access', role: 'ADMIN' },
      { secret, issuer: 'file-storage-platform', audience: 'file-storage-web' },
    );
    await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${roleClaimToken}`)
      .expect(403);
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', userAuth)
      .expect(200);
    expect(me.body.data.role).toBe('USER');
    await request(app.getHttpServer())
      .get('/api/v1/admin/projects')
      .set('Authorization', userAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit-events')
      .set('Authorization', userAuth)
      .expect(403);
  });

  it('allows a manually promoted admin and denies the same token after demotion', async () => {
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', userAuth)
      .send({ name: 'Admin report fixture' })
      .expect(201);
    const projectId = project.body.data.id as string;
    projectIds.push(projectId);
    const key = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/api-keys`)
      .set('Authorization', userAuth)
      .send({ name: 'read key', scopes: ['projects:read'] })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .set('Authorization', `ApiKey ${key.body.data.token as string}`)
      .expect(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
    });

    const overview = await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .set('Authorization', userAuth)
      .expect(200);
    expect(overview.body.data).toMatchObject({
      projectCount: expect.any(Number),
      userCount: expect.any(Number),
      fileCount: expect.any(Number),
      quotaBytes: expect.stringMatching(/^\d+$/),
      usedBytes: expect.stringMatching(/^\d+$/),
      reservedBytes: expect.stringMatching(/^\d+$/),
    });
    expect(overview.body.data.projectCount).toBeGreaterThanOrEqual(1);
    expect(BigInt(overview.body.data.quotaBytes)).toBeGreaterThanOrEqual(
      10737418240n,
    );
    const operations = await request(app.getHttpServer())
      .get('/api/v1/admin/operations')
      .set('Authorization', userAuth)
      .expect(200);
    expect(operations.body.data).toMatchObject({
      diskFreeBytes: expect.stringMatching(/^\d+$/),
      temporaryBytes: expect.stringMatching(/^\d+$/),
      activeUploads: expect.any(Number),
      activeDownloads: expect.any(Number),
      temporaryFiles: expect.any(Number),
    });
    expect(operations.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(operations.body)).not.toContain('storageRoot');
    expect(JSON.stringify(operations.body)).not.toContain('jwtAccessSecret');

    const projects = await request(app.getHttpServer())
      .get('/api/v1/admin/projects?page=1&pageSize=1')
      .set('Authorization', userAuth)
      .expect(200);
    expect(projects.body.data).toMatchObject({ page: 1, pageSize: 1 });
    expect(projects.body.data.items[0]).toMatchObject({
      id: projectId,
      ownerId: user.id,
      name: 'Admin report fixture',
      quotaBytes: '10737418240',
    });
    expect(JSON.stringify(projects.body.data)).not.toContain('passwordHash');

    const events = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit-events?projectId=${projectId}`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(events.body.data.items[0]).toMatchObject({
      projectId,
      action: 'API_KEY_ISSUED',
    });
    expect(JSON.stringify(events.body.data)).not.toContain(
      'Admin report fixture',
    );
    expect(JSON.stringify(events.body.data)).not.toContain(key.body.data.token);

    for (const path of [
      '/api/v1/admin/projects?page=0',
      '/api/v1/admin/projects?page=1000001',
      '/api/v1/admin/projects?pageSize=101',
      '/api/v1/admin/audit-events?page=1000001',
      '/api/v1/admin/audit-events?projectId=not-a-uuid',
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', userAuth)
        .expect(400);
    }

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}`)
      .set('Authorization', userAuth)
      .expect(204);
    const retained = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit-events?projectId=${projectId}`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(retained.body.data.items[0]).toMatchObject({
      action: 'PROJECT_DELETED',
      projectId,
      purgeAfter: expect.any(String),
    });
    expect(
      new Date(retained.body.data.items[0].purgeAfter).getTime(),
    ).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60_000);

    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'USER' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/overview')
      .set('Authorization', userAuth)
      .expect(403);
  });
});
