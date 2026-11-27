import { Prisma } from '../../generated/prisma/client.js';
import type { AuditEntry } from './audit.repository.js';

export function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditEvent.create({ data: entry });
}

export async function recordProjectDeleted(
  tx: Prisma.TransactionClient,
  projectId: string,
  ownerId: string,
  now: Date,
) {
  const purgeAfter = new Date(now.getTime() + 90 * 24 * 60 * 60_000);
  await tx.auditEvent.updateMany({
    where: { projectId },
    data: { purgeAfter },
  });
  await tx.auditEvent.create({
    data: {
      projectId,
      actorType: 'USER',
      actorId: ownerId,
      action: 'PROJECT_DELETED',
      resourceId: projectId,
      occurredAt: now,
      purgeAfter,
    },
  });
}
