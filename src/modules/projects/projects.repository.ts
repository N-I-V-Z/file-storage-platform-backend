import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { recordAudit, recordProjectDeleted } from '../audit/audit-writer.js';

const projectFields = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProjectsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  create(ownerId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          ownerId,
          name,
          quotaBytes: BigInt(this.config.getOrThrow('projectQuotaBytes')),
        },
        select: projectFields,
      });
      await recordAudit(tx, {
        projectId: project.id,
        actorType: 'USER',
        actorId: ownerId,
        action: 'PROJECT_CREATED',
        resourceId: project.id,
      });
      return project;
    });
  }

  list(ownerId: string) {
    return this.prisma.project.findMany({
      where: { ownerId },
      select: projectFields,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOwned(ownerId: string, id: string) {
    return this.prisma.project.findFirst({
      where: { id, ownerId },
      select: projectFields,
    });
  }

  findOwnedUsage(ownerId: string, id: string) {
    return this.prisma.project.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        quotaBytes: true,
        usedBytes: true,
        reservedBytes: true,
      },
    });
  }

  async renameOwned(ownerId: string, id: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { id, ownerId },
        data: { name },
      });
      if (result.count === 0) return null;
      await recordAudit(tx, {
        projectId: id,
        actorType: 'USER',
        actorId: ownerId,
        action: 'PROJECT_RENAMED',
        resourceId: id,
      });
      return tx.project.findUniqueOrThrow({
        where: { id },
        select: projectFields,
      });
    });
  }

  async deleteOwned(ownerId: string, id: string) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.project.deleteMany({
          where: { id, ownerId, files: { none: {} } },
        });
        if (deleted.count)
          await recordProjectDeleted(tx, id, ownerId, new Date());
        return deleted;
      });
      if (result.count > 0) return 'deleted' as const;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2003'
      ) {
        return 'has-files' as const;
      }
      throw error;
    }
    return (await this.findOwned(ownerId, id))
      ? ('has-files' as const)
      : ('not-found' as const);
  }
}
