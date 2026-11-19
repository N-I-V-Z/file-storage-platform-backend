import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ValidatedEnvironment } from '../../config/env.validation.js';

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
    return this.prisma.project.create({
      data: {
        ownerId,
        name,
        quotaBytes: BigInt(this.config.getOrThrow('projectQuotaBytes')),
      },
      select: projectFields,
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

  async renameOwned(ownerId: string, id: string, name: string) {
    const result = await this.prisma.project.updateMany({
      where: { id, ownerId },
      data: { name },
    });
    if (result.count === 0) return null;
    return this.findOwned(ownerId, id);
  }

  async deleteOwned(ownerId: string, id: string) {
    try {
      const result = await this.prisma.project.deleteMany({
        where: { id, ownerId, files: { none: {} } },
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
