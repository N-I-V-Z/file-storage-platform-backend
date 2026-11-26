import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { FilesystemStorage } from '../src/infrastructure/storage/filesystem-storage.js';
import { STORAGE_ADAPTER } from '../src/infrastructure/storage/storage-adapter.js';
import { AuditReconciler } from '../src/modules/audit/audit-reconciler.js';

describe('project audit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authorization: string;
  let foreignAuthorization: string;
  let storageRoot: string;
  const projectIds: string[] = [];
  const email = `audit-${randomUUID()}@example.com`;
  const foreignEmail = `audit-${randomUUID()}@example.com`;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'fsp-audit-'));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useFactory({ factory: () => new FilesystemStorage(storageRoot) })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, app.get(ConfigService));
    await app.init();
    prisma = app.get(PrismaService);
    for (const address of [email, foreignEmail]) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: address, password: 'long-test-password' })
        .expect(201);
    }
    for (const [address, assign] of [
      [email, (value: string) => (authorization = value)],
      [foreignEmail, (value: string) => (foreignAuthorization = value)],
    ] as const) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: address, password: 'long-test-password' })
        .expect(200);
      assign(`Bearer ${response.body.data.accessToken as string}`);
    }
  });

  afterAll(async () => {
    if (app) {
      if (prisma) {
        if (projectIds.length) {
          await prisma.storedFile.deleteMany({
            where: { projectId: { in: projectIds } },
          });
          await prisma.auditEvent.deleteMany({
            where: { projectId: { in: projectIds } },
          });
        }
        await prisma.user.deleteMany({
          where: { email: { in: [email, foreignEmail] } },
        });
      }
      await app.close();
    }
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('records project changes and allows only the owner to read them', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', authorization)
      .send({ name: 'Audit project' })
      .expect(201);
    const projectId = created.body.data.id as string;
    projectIds.push(projectId);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', authorization)
      .send({ name: 'Renamed project' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/audit-events`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/audit-events`)
      .set('Authorization', foreignAuthorization)
      .expect(404);
    const history = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/audit-events?pageSize=1&page=1`)
      .set('Authorization', authorization)
      .expect(200);
    expect(history.body.data).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(history.body.data.items[0]).toMatchObject({
      projectId,
      action: 'PROJECT_RENAMED',
      actorType: 'USER',
      resourceId: projectId,
    });
    expect(JSON.stringify(history.body.data)).not.toContain('Renamed project');

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}`)
      .set('Authorization', authorization)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/audit-events`)
      .set('Authorization', authorization)
      .expect(404);
  });

  it('records key issue and revoke without retaining the secret or key name', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', authorization)
      .send({ name: 'Keys' })
      .expect(201);
    const projectId = created.body.data.id as string;
    projectIds.push(projectId);
    const issued = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/api-keys`)
      .set('Authorization', authorization)
      .send({ name: 'secret key label', scopes: ['files:read'] })
      .expect(201);
    const keyId = issued.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/api-keys/${keyId}`)
      .set('Authorization', authorization)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/api-keys/${keyId}`)
      .set('Authorization', authorization)
      .expect(404);
    const history = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/audit-events`)
      .set('Authorization', authorization)
      .expect(200);
    expect(
      history.body.data.items.map((item: { action: string }) => item.action),
    ).toEqual(['API_KEY_REVOKED', 'API_KEY_ISSUED', 'PROJECT_CREATED']);
    expect(JSON.stringify(history.body.data)).not.toContain(
      issued.body.data.token,
    );
    expect(JSON.stringify(history.body.data)).not.toContain('secret key label');
    expect(history.body.data.items[0].resourceId).toBe(keyId);
  });

  it('records upload, trash, restore and purge once with actor attribution', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', authorization)
      .send({ name: 'Files' })
      .expect(201);
    const projectId = created.body.data.id as string;
    projectIds.push(projectId);
    const keyResponse = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/api-keys`)
      .set('Authorization', authorization)
      .send({ name: 'upload key', scopes: ['files:write'] })
      .expect(201);
    const keyId = keyResponse.body.data.id as string;
    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/files`)
      .set('Authorization', `ApiKey ${keyResponse.body.data.token as string}`)
      .attach('file', Buffer.from('%PDF-1.7\naudit'), {
        filename: 'private-document.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const fileId = uploaded.body.data.id as string;
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .set('Authorization', authorization)
      .expect(204);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/trash/${fileId}/restore`)
      .set('Authorization', authorization)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/files/${fileId}`)
      .set('Authorization', authorization)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/trash/${fileId}`)
      .set('Authorization', authorization)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectId}/trash/${fileId}`)
      .set('Authorization', authorization)
      .expect(404);
    const history = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/audit-events`)
      .set('Authorization', authorization)
      .expect(200);
    const actions = history.body.data.items.map(
      (item: { action: string }) => item.action,
    );
    expect(actions).toEqual([
      'FILE_PURGED',
      'FILE_PURGE_REQUESTED',
      'FILE_TRASHED',
      'FILE_RESTORED',
      'FILE_TRASHED',
      'FILE_UPLOADED',
      'API_KEY_ISSUED',
      'PROJECT_CREATED',
    ]);
    expect(
      history.body.data.items.find(
        (item: { action: string }) => item.action === 'FILE_UPLOADED',
      ),
    ).toMatchObject({
      actorType: 'API_KEY',
      actorId: keyId,
      resourceId: fileId,
    });
    expect(JSON.stringify(history.body.data)).not.toContain(
      'private-document.pdf',
    );
    expect(JSON.stringify(history.body.data)).not.toContain(
      keyResponse.body.data.token,
    );
  });

  it('sets retention on direct project deletion and cleans only expired events', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', authorization)
      .send({ name: 'Direct deletion' })
      .expect(201);
    const projectId = created.body.data.id as string;
    projectIds.push(projectId);
    await prisma.project.delete({ where: { id: projectId } });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { projectId },
    });
    expect(event.purgeAfter!.getTime()).toBeGreaterThan(
      Date.now() + 89 * 24 * 60 * 60_000,
    );

    const expiredId = randomUUID();
    await prisma.auditEvent.create({
      data: {
        id: expiredId,
        projectId,
        actorType: 'SYSTEM',
        action: 'FILE_PURGED',
        resourceId: randomUUID(),
        purgeAfter: new Date(Date.now() - 1_000),
      },
    });
    await app.get(AuditReconciler).run();
    expect(
      await prisma.auditEvent.findUnique({ where: { id: expiredId } }),
    ).toBeNull();
    expect(
      await prisma.auditEvent.findUnique({ where: { id: event.id } }),
    ).not.toBeNull();
  });
});
