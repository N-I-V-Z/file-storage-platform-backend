import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FileListQueryDto } from './dto/file-list-query.dto.js';
import type { StoredFileStatus } from '../../generated/prisma/enums.js';
import { recordAudit } from '../audit/audit-writer.js';

@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  listReady(projectId: string, query: FileListQueryDto) {
    return this.listByStatus(projectId, query, 'READY');
  }

  listTrashed(projectId: string, query: FileListQueryDto) {
    return this.listByStatus(projectId, query, 'TRASHED');
  }

  private async listByStatus(
    projectId: string,
    query: FileListQueryDto,
    status: StoredFileStatus,
  ) {
    const where: Prisma.StoredFileWhereInput = {
      projectId,
      status,
      ...(query.search
        ? {
            originalName: {
              contains: query.search.replace(
                /[\\%_]/g,
                (value) => `\\${value}`,
              ),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.contentType ? { contentType: query.contentType } : {}),
      ...(query.folderId
        ? { folderId: query.folderId === 'root' ? null : query.folderId }
        : {}),
    };
    const orderBy: Prisma.StoredFileOrderByWithRelationInput[] =
      query.sort === 'oldest'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : query.sort === 'name-asc'
          ? [{ originalName: 'asc' }, { id: 'asc' }]
          : query.sort === 'name-desc'
            ? [{ originalName: 'desc' }, { id: 'desc' }]
            : query.sort === 'size-asc'
              ? [{ sizeBytes: 'asc' }, { id: 'asc' }]
              : query.sort === 'size-desc'
                ? [{ sizeBytes: 'desc' }, { id: 'desc' }]
                : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [items, total] = await Promise.all([
      this.prisma.storedFile.findMany({
        where,
        select: {
          id: true,
          projectId: true,
          folderId: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          createdAt: true,
          trashedAt: true,
          purgeAfter: true,
        },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.storedFile.count({ where }),
    ]);
    return { items, total };
  }

  async trash(
    projectId: string,
    fileId: string,
    now: Date,
    purgeAfter: Date,
    ownerId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.storedFile.updateMany({
        where: { id: fileId, projectId, status: 'READY' },
        data: { status: 'TRASHED', trashedAt: now, purgeAfter },
      });
      if (!changed.count) return false;
      await tx.shareLink.updateMany({
        where: { fileId, revokedAt: null },
        data: { revokedAt: now },
      });
      await recordAudit(tx, {
        projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'FILE_TRASHED',
        resourceId: fileId,
      });
      return true;
    });
  }

  findTrashed(projectId: string, fileId: string) {
    return this.prisma.storedFile.findFirst({
      where: { id: fileId, projectId, status: 'TRASHED' },
      select: { id: true, purgeAfter: true },
    });
  }

  async restore(projectId: string, fileId: string, now: Date, ownerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.storedFile.updateMany({
        where: {
          id: fileId,
          projectId,
          status: 'TRASHED',
          purgeAfter: { gt: now },
        },
        data: { status: 'READY', trashedAt: null, purgeAfter: null },
      });
      if (!changed.count) return false;
      await recordAudit(tx, {
        projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'FILE_RESTORED',
        resourceId: fileId,
      });
      return true;
    });
  }

  async claimPurge(projectId: string, fileId: string, ownerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.storedFile.updateMany({
        where: { id: fileId, projectId, status: 'TRASHED' },
        data: { status: 'PURGING' },
      });
      if (!changed.count) return false;
      await recordAudit(tx, {
        projectId,
        actorType: 'USER',
        actorId: ownerId,
        action: 'FILE_PURGE_REQUESTED',
        resourceId: fileId,
      });
      return true;
    });
  }

  async claimExpired(fileId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findFirst({
        where: { id: fileId, status: 'TRASHED', purgeAfter: { lte: now } },
        select: { projectId: true },
      });
      if (!file) return false;
      const changed = await tx.storedFile.updateMany({
        where: { id: fileId, status: 'TRASHED', purgeAfter: { lte: now } },
        data: { status: 'PURGING' },
      });
      if (!changed.count) return false;
      await recordAudit(tx, {
        projectId: file.projectId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'FILE_PURGE_REQUESTED',
        resourceId: fileId,
      });
      return true;
    });
  }

  findPurging(fileId: string) {
    return this.prisma.storedFile.findFirst({
      where: { id: fileId, status: 'PURGING' },
      select: { id: true, storageKey: true },
    });
  }

  listPurgeCandidates(now: Date) {
    return this.prisma.storedFile.findMany({
      where: {
        OR: [
          { status: 'PURGING' },
          { status: 'TRASHED', purgeAfter: { lte: now } },
        ],
      },
      select: { id: true, status: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }

  async touchPurgeAttempt(fileId: string) {
    await this.prisma.storedFile.updateMany({
      where: { id: fileId, status: 'PURGING' },
      data: { updatedAt: new Date() },
    });
  }

  finalizePurge(fileId: string) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findFirst({
        where: { id: fileId, status: 'PURGING' },
        select: { id: true, projectId: true, sizeBytes: true },
      });
      if (!file) return false;
      if (file.sizeBytes === null)
        throw new Error('Purging file has no byte size');
      const removed = await tx.storedFile.deleteMany({
        where: { id: fileId, status: 'PURGING' },
      });
      if (!removed.count) return false;
      await tx.project.update({
        where: { id: file.projectId },
        data: { usedBytes: { decrement: file.sizeBytes } },
      });
      await recordAudit(tx, {
        projectId: file.projectId,
        actorType: 'SYSTEM',
        actorId: null,
        action: 'FILE_PURGED',
        resourceId: fileId,
      });
      return true;
    });
  }

  findReady(projectId: string, fileId: string) {
    return this.prisma.storedFile.findFirst({
      where: { id: fileId, projectId, status: 'READY' },
      select: {
        id: true,
        storageKey: true,
        originalName: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
      },
    });
  }
}
