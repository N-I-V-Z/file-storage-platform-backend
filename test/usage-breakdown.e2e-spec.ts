import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { StoredFileStatus } from '../src/generated/prisma/enums.js';

describe('project usage breakdown (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;
  let auth: string;
  let foreignAuth: string;
  const email = `usage-${randomUUID()}@example.com`;
  const foreignEmail = `usage-${randomUUID()}@example.com`;
  const large = 9007199254740993n;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    prisma = app.get(PrismaService);
    for (const account of [email, foreignEmail]) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: account, password: 'long-test-password' })
        .expect(201);
    }
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'long-test-password' })
      .expect(200);
    auth = `Bearer ${login.body.data.accessToken as string}`;
    const foreignLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: foreignEmail, password: 'long-test-password' })
      .expect(200);
    foreignAuth = `Bearer ${foreignLogin.body.data.accessToken as string}`;
    const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
    const project = await prisma.project.create({
      data: {
        ownerId: owner.id,
        name: 'Usage breakdown',
        quotaBytes: large + 1000n,
        usedBytes: large + 12n,
        reservedBytes: 24n,
      },
    });
    projectId = project.id;
    const entries: Array<[StoredFileStatus, bigint | null, bigint]> = [
      ['READY', large, large],
      ['TRASHED', 5n, 5n],
      ['PURGING', 7n, 7n],
      ['UPLOADING', null, 11n],
      ['ABANDONED', null, 13n],
    ];
    for (const [status, sizeBytes, reservationBytes] of entries) {
      await prisma.storedFile.create({
        data: {
          projectId,
          storageKey: randomUUID(),
          originalName: `${status}.pdf`,
          contentType: 'application/pdf',
          status,
          reservationBytes,
          sizeBytes,
          sha256: sizeBytes === null ? null : 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
          ...(status === 'TRASHED' || status === 'PURGING'
            ? {
                trashedAt: new Date(),
                purgeAfter: new Date(Date.now() + 60_000),
              }
            : {}),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.storedFile.deleteMany({ where: { projectId } });
    await prisma.user.deleteMany({
      where: { email: { in: [email, foreignEmail] } },
    });
    await app.close();
  });

  it('reports metadata buckets and exact decimal balances to the owner', async () => {
    const result = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage/breakdown`)
      .set('Authorization', auth)
      .expect(200);
    expect(result.body.data).toEqual({
      projectId,
      quotaBytes: (large + 1000n).toString(),
      usedBytes: (large + 12n).toString(),
      reservedBytes: '24',
      readyBytes: large.toString(),
      trashBytes: '12',
      pendingBytes: '24',
      matchesBalance: true,
    });
    const original = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage`)
      .set('Authorization', auth)
      .expect(200);
    expect(original.body.data).toEqual({
      projectId,
      quotaBytes: (large + 1000n).toString(),
      usedBytes: (large + 12n).toString(),
      reservedBytes: '24',
    });
  });

  it('detects counter drift and a finalized row without a size', async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { usedBytes: { increment: 1n } },
    });
    const drift = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage/breakdown`)
      .set('Authorization', auth)
      .expect(200);
    expect(drift.body.data.matchesBalance).toBe(false);
    await prisma.project.update({
      where: { id: projectId },
      data: { usedBytes: { decrement: 1n } },
    });
    await prisma.storedFile.create({
      data: {
        projectId,
        storageKey: randomUUID(),
        originalName: 'broken.pdf',
        contentType: 'application/pdf',
        status: 'TRASHED',
        reservationBytes: 1n,
        sizeBytes: null,
        expiresAt: new Date(Date.now() + 60_000),
        trashedAt: new Date(),
        purgeAfter: new Date(Date.now() + 60_000),
      },
    });
    const invalid = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/usage/breakdown`)
      .set('Authorization', auth)
      .expect(200);
    expect(invalid.body.data.matchesBalance).toBe(false);
  });

  it('hides foreign and missing projects', async () => {
    const path = `/api/v1/projects/${projectId}/usage/breakdown`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', foreignAuth)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${randomUUID()}/usage/breakdown`)
      .set('Authorization', auth)
      .expect(404);
  });
});
