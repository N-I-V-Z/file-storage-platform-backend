import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';

describe('project file listing (e2e)', () => {
  let app: INestApplication;
  let projectId: string;
  let ownerAuth: string;
  let foreignAuth: string;
  const ownerEmail = `files-${randomUUID()}@example.com`;
  const foreignEmail = `files-${randomUUID()}@example.com`;
  const path = () => `/api/v1/projects/${projectId}/files`;

  async function account(email: string) {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'long-test-password' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'long-test-password' })
      .expect(200);
    return `Bearer ${login.body.data.accessToken as string}`;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    ownerAuth = await account(ownerEmail);
    foreignAuth = await account(foreignEmail);
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', ownerAuth)
      .send({ name: 'Explorer' })
      .expect(201);
    projectId = project.body.data.id as string;
    const prisma = app.get(PrismaService);
    const base = {
      projectId,
      reservationBytes: BigInt(100),
      expiresAt: new Date(Date.now() + 60_000),
    };
    const create = (
      name: string,
      mime: string,
      size: number,
      day: number,
      status: 'READY' | 'UPLOADING' = 'READY',
    ) =>
      prisma.storedFile.create({
        data: {
          ...base,
          storageKey: randomUUID(),
          originalName: name,
          contentType: mime,
          status,
          sizeBytes: status === 'READY' ? BigInt(size) : null,
          sha256: status === 'READY' ? 'a'.repeat(64) : null,
          createdAt: new Date(`2026-11-${day}T00:00:00.000Z`),
        },
      });
    await create('Alpha.pdf', 'application/pdf', 10, 16);
    await create('beta.png', 'image/png', 20, 17);
    await create('Gamma.pdf', 'application/pdf', 30, 18);
    await create('hidden.pdf', 'application/pdf', 40, 19, 'UPLOADING');
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({ where: { projectId } });
      await prisma.user.deleteMany({
        where: { email: { in: [ownerEmail, foreignEmail] } },
      });
      await app.close();
    }
  });

  it('requires the owner JWT and never exposes private storage keys', async () => {
    await request(app.getHttpServer()).get(path()).expect(401);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', foreignAuth)
      .expect(404);
    const response = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(response.body.data).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 3,
    });
    expect(response.body.data.items).toHaveLength(3);
    expect(response.body.data.items[0]).toMatchObject({
      originalName: 'Gamma.pdf',
      sizeBytes: '30',
      status: 'ready',
    });
    expect(JSON.stringify(response.body.data)).not.toContain('storageKey');
    expect(JSON.stringify(response.body.data)).not.toContain('hidden.pdf');
  });

  it('paginates, searches, filters and sorts with deterministic results', async () => {
    const first = await request(app.getHttpServer())
      .get(path())
      .query({ page: 1, pageSize: 2, sort: 'size-asc' })
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(
      first.body.data.items.map(
        (item: { originalName: string }) => item.originalName,
      ),
    ).toEqual(['Alpha.pdf', 'beta.png']);
    expect(first.body.data.total).toBe(3);
    const second = await request(app.getHttpServer())
      .get(path())
      .query({ page: 2, pageSize: 2, sort: 'size-asc' })
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(
      second.body.data.items.map(
        (item: { originalName: string }) => item.originalName,
      ),
    ).toEqual(['Gamma.pdf']);
    const filtered = await request(app.getHttpServer())
      .get(path())
      .query({ search: 'GAM', contentType: 'application/pdf' })
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].originalName).toBe('Gamma.pdf');
  });

  it('rejects invalid or unbounded query options', async () => {
    for (const query of [
      { page: 0 },
      { pageSize: 101 },
      { sort: 'storage-key' },
      { contentType: 'text/html' },
      { search: 'x'.repeat(121) },
      { unknown: 'value' },
    ]) {
      await request(app.getHttpServer())
        .get(path())
        .query(query)
        .set('Authorization', ownerAuth)
        .expect(400);
    }
  });
});
