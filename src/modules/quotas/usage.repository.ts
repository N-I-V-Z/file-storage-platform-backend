import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class UsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  readSnapshot(ownerId: string, projectId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: projectId, ownerId },
          select: {
            id: true,
            quotaBytes: true,
            usedBytes: true,
            reservedBytes: true,
          },
        });
        if (!project) return null;
        const groups = await tx.storedFile.groupBy({
          by: ['status'],
          where: { projectId },
          _sum: { sizeBytes: true, reservationBytes: true },
          _count: { _all: true, sizeBytes: true },
        });
        return { project, groups };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
