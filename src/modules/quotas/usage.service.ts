import { Injectable, NotFoundException } from '@nestjs/common';
import { UsageRepository } from './usage.repository.js';

@Injectable()
export class UsageService {
  constructor(private readonly usage: UsageRepository) {}

  async breakdown(ownerId: string, projectId: string) {
    const snapshot = await this.usage.readSnapshot(ownerId, projectId);
    if (!snapshot) throw new NotFoundException('Project not found');
    let readyBytes = 0n;
    let trashBytes = 0n;
    let pendingBytes = 0n;
    let missingFinalizedSize = false;
    for (const group of snapshot.groups) {
      if (group.status === 'READY') {
        readyBytes += group._sum.sizeBytes ?? 0n;
        missingFinalizedSize ||= group._count.sizeBytes !== group._count._all;
      } else if (group.status === 'TRASHED' || group.status === 'PURGING') {
        trashBytes += group._sum.sizeBytes ?? 0n;
        missingFinalizedSize ||= group._count.sizeBytes !== group._count._all;
      } else {
        pendingBytes += group._sum.reservationBytes ?? 0n;
      }
    }
    const { project } = snapshot;
    return {
      projectId: project.id,
      quotaBytes: project.quotaBytes.toString(),
      usedBytes: project.usedBytes.toString(),
      reservedBytes: project.reservedBytes.toString(),
      readyBytes: readyBytes.toString(),
      trashBytes: trashBytes.toString(),
      pendingBytes: pendingBytes.toString(),
      matchesBalance:
        !missingFinalizedSize &&
        project.usedBytes === readyBytes + trashBytes &&
        project.reservedBytes === pendingBytes,
    };
  }
}
