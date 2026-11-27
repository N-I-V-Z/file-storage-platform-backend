import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export type AuditAction =
  | 'PROJECT_CREATED'
  | 'PROJECT_RENAMED'
  | 'PROJECT_DELETED'
  | 'API_KEY_ISSUED'
  | 'API_KEY_REVOKED'
  | 'FILE_UPLOADED'
  | 'FILE_TRASHED'
  | 'FILE_RESTORED'
  | 'FILE_PURGE_REQUESTED'
  | 'FILE_PURGED'
  | 'SHARE_LINK_CREATED'
  | 'SHARE_LINK_REVOKED';

export interface AuditEntry {
  projectId: string;
  actorType: 'USER' | 'API_KEY' | 'SYSTEM';
  actorId: string | null;
  action: AuditAction;
  resourceId: string;
}

const eventFields = {
  id: true,
  projectId: true,
  actorType: true,
  actorId: true,
  action: true,
  resourceId: true,
  occurredAt: true,
} as const;

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, page: number, pageSize: number) {
    const where = { projectId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        select: eventFields,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { items, total };
  }

  async deleteExpired(now: Date) {
    return this.prisma.$executeRaw`
      DELETE FROM audit_events
      WHERE id IN (
        SELECT id FROM audit_events
        WHERE purge_after <= ${now}
        ORDER BY purge_after, id
        LIMIT 1000
      )
    `;
  }
}
