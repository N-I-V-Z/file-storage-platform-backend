import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/config/configure-http.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';

describe('project folders (e2e)', () => {
  let app: INestApplication;
  let projectId: string;
  let ownerAuth: string;
  let foreignAuth: string;
  const ownerEmail = `folders-${randomUUID()}@example.com`;
  const foreignEmail = `folders-${randomUUID()}@example.com`;
  const path = () => `/api/v1/projects/${projectId}/folders`;

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
    const response = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', ownerAuth)
      .send({ name: 'Folders' })
      .expect(201);
    projectId = response.body.data.id as string;
  });

  afterAll(async () => {
    if (app) {
      const prisma = app.get(PrismaService);
      await prisma.storedFile.deleteMany({
        where: {
          project: { owner: { email: { in: [ownerEmail, foreignEmail] } } },
        },
      });
      await prisma.user.deleteMany({
        where: { email: { in: [ownerEmail, foreignEmail] } },
      });
      await app.close();
    }
  });

  it('creates, lists, renames and deletes project folders', async () => {
    const created = await request(app.getHttpServer())
      .post(path())
      .set('Authorization', ownerAuth)
      .send({ name: '  Assets  ' })
      .expect(201);
    const folderId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ projectId, name: 'Assets' });
    await request(app.getHttpServer())
      .post(path())
      .set('Authorization', ownerAuth)
      .send({ name: 'assets' })
      .expect(409);
    const list = await request(app.getHttpServer())
      .get(path())
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(folderId);
    const other = await request(app.getHttpServer())
      .post(path())
      .set('Authorization', ownerAuth)
      .send({ name: 'Other' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${path()}/${folderId}`)
      .set('Authorization', ownerAuth)
      .send({ name: 'other' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${path()}/${folderId}`)
      .set('Authorization', foreignAuth)
      .send({ name: 'Stolen' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${path()}/${folderId}`)
      .set('Authorization', foreignAuth)
      .expect(404);
    const renamed = await request(app.getHttpServer())
      .patch(`${path()}/${folderId}`)
      .set('Authorization', ownerAuth)
      .send({ name: 'Documents' })
      .expect(200);
    expect(renamed.body.data.name).toBe('Documents');
    await request(app.getHttpServer())
      .delete(`${path()}/${folderId}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`${path()}/${other.body.data.id as string}`)
      .set('Authorization', ownerAuth)
      .expect(204);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', ownerAuth)
      .expect(200)
      .expect((response) => expect(response.body.data).toEqual([]));
  });

  it('isolates folders by owner and rejects invalid names', async () => {
    await request(app.getHttpServer()).get(path()).expect(401);
    await request(app.getHttpServer())
      .get(path())
      .set('Authorization', foreignAuth)
      .expect(404);
    await request(app.getHttpServer())
      .post(path())
      .set('Authorization', foreignAuth)
      .send({ name: 'Stolen' })
      .expect(404);
    for (const name of [
      '',
      '   ',
      '../escape',
      'a/b',
      'a\\b',
      'x'.repeat(121),
    ]) {
      await request(app.getHttpServer())
        .post(path())
        .set('Authorization', ownerAuth)
        .send({ name })
        .expect(400);
    }
  });

  it('refuses to delete a folder containing a file', async () => {
    const created = await request(app.getHttpServer())
      .post(path())
      .set('Authorization', ownerAuth)
      .send({ name: 'Keep' })
      .expect(201);
    const folderId = created.body.data.id as string;
    await app.get(PrismaService).storedFile.create({
      data: {
        projectId,
        folderId,
        storageKey: randomUUID(),
        originalName: 'keep.pdf',
        contentType: 'application/pdf',
        status: 'READY',
        reservationBytes: BigInt(10),
        sizeBytes: BigInt(10),
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await request(app.getHttpServer())
      .delete(`${path()}/${folderId}`)
      .set('Authorization', ownerAuth)
      .expect(409);
  });
});
