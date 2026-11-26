import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const projectFields = {
  id: true,
  ownerId: true,
  name: true,
  quotaBytes: true,
  usedBytes: true,
  reservedBytes: true,
  createdAt: true,
} as const;

const eventFields = {
  id: true,
  projectId: true,
  actorType: true,
  actorId: true,
  action: true,
  resourceId: true,
  occurredAt: true,
  purgeAfter: true,
} as const;

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  overview() {
    return this.prisma.$transaction(
      async (tx) => {
        const [userCount, projects, fileCount] = await Promise.all([
          tx.user.count(),
          tx.project.aggregate({
            _count: { _all: true },
            _sum: { quotaBytes: true, usedBytes: true, reservedBytes: true },
          }),
          tx.storedFile.count({ where: { status: 'READY' } }),
        ]);
        return { userCount, projects, fileCount };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  listProjects(page: number, pageSize: number) {
    return this.prisma.$transaction(
      async (tx) => {
        const [items, total] = await Promise.all([
          tx.project.findMany({
            select: projectFields,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.project.count(),
        ]);
        return { items, total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  listAudit(page: number, pageSize: number, projectId?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const where: Prisma.AuditEventWhereInput = {
          ...(projectId ? { projectId } : {}),
          OR: [{ purgeAfter: null }, { purgeAfter: { gt: new Date() } }],
        };
        const [items, total] = await Promise.all([
          tx.auditEvent.findMany({
            where,
            select: eventFields,
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.auditEvent.count({ where }),
        ]);
        return { items, total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
