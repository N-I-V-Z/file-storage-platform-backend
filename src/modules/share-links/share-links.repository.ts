import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { recordAudit } from '../audit/audit-writer.js';

const linkFields = {
  id: true,
  fileId: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ShareLinksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    ownerId: string,
    projectId: string,
    fileId: string,
    tokenHash: string,
    expiresAt: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findFirst({
        where: {
          id: fileId,
          projectId,
          status: 'READY',
          scannedAt: { not: null },
          project: { ownerId },
        },
        select: { id: true },
      });
      if (!file) return null;
      const link = await tx.shareLink.create({
        data: { fileId, tokenHash, expiresAt },
        select: linkFields,
      });
      await recordAudit(tx, {
        projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'SHARE_LINK_CREATED',
        resourceId: link.id,
      });
      return link;
    });
  }

  async list(ownerId: string, projectId: string, fileId: string) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, projectId, project: { ownerId } },
      select: { id: true },
    });
    if (!file) return null;
    return this.prisma.shareLink.findMany({
      where: { fileId },
      select: linkFields,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async revoke(ownerId: string, projectId: string, fileId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findFirst({
        where: { id: fileId, projectId, project: { ownerId } },
        select: { id: true },
      });
      if (!file) return false;
      const changed = await tx.shareLink.updateMany({
        where: { id, fileId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!changed.count) return false;
      await recordAudit(tx, {
        projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'SHARE_LINK_REVOKED',
        resourceId: id,
      });
      return true;
    });
  }

  findActive(tokenHash: string, now: Date) {
    return this.prisma.shareLink.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        file: { status: 'READY', scannedAt: { not: null } },
      },
      select: { file: { select: { id: true, projectId: true } } },
    });
  }
}
