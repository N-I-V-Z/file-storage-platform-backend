import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { recordAudit } from '../audit/audit-writer.js';

const keyFields = {
  id: true,
  projectId: true,
  name: true,
  scopes: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwnedProject(ownerId: string, projectId: string) {
    return this.prisma.project.findFirst({
      where: { id: projectId, ownerId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
  }

  create(
    data: {
      id: string;
      projectId: string;
      name: string;
      tokenHash: string;
      scopes: string[];
      expiresAt: Date | null;
    },
    ownerId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const key = await tx.apiKey.create({ data, select: keyFields });
      await recordAudit(tx, {
        projectId: data.projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'API_KEY_ISSUED',
        resourceId: key.id,
      });
      return key;
    });
  }

  list(projectId: string) {
    return this.prisma.apiKey.findMany({
      where: { projectId },
      select: keyFields,
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(projectId: string, id: string, ownerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.apiKey.updateMany({
        where: { id, projectId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!result.count) return false;
      await recordAudit(tx, {
        projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'API_KEY_REVOKED',
        resourceId: id,
      });
      return true;
    });
  }

  findForVerification(id: string) {
    return this.prisma.apiKey.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, createdAt: true, updatedAt: true },
        },
      },
    });
  }

  async touchIfActive(id: string) {
    const result = await this.prisma.apiKey.updateMany({
      where: {
        id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data: { lastUsedAt: new Date() },
    });
    return result.count > 0;
  }
}
