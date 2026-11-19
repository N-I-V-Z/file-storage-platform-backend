import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface ReserveUpload {
  id: string;
  projectId: string;
  storageKey: string;
  originalName: string;
  contentType: string;
  reservationBytes: bigint;
}

@Injectable()
export class QuotasRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  reserve(input: ReserveUpload) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE projects
        SET reserved_bytes = reserved_bytes + ${input.reservationBytes}
        WHERE id = ${input.projectId}::uuid
          AND quota_bytes - used_bytes - reserved_bytes >= ${input.reservationBytes}
        RETURNING id
      `;
      if (changed.length === 0) return null;
      return tx.storedFile.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          storageKey: input.storageKey,
          originalName: input.originalName,
          contentType: input.contentType,
          reservationBytes: input.reservationBytes,
          expiresAt: new Date(
            Date.now() +
              this.config.getOrThrow('uploadTimeoutMs') +
              10 * 60_000,
          ),
        },
      });
    });
  }

  finalize(id: string, sizeBytes: bigint, sha256: string) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findUnique({ where: { id } });
      if (!file || file.status !== 'UPLOADING') return null;
      if (sizeBytes > file.reservationBytes || sizeBytes < 0n) {
        throw new Error('File size exceeds reservation');
      }
      const changed = await tx.storedFile.updateMany({
        where: { id, status: 'UPLOADING' },
        data: { status: 'READY', sizeBytes, sha256 },
      });
      if (changed.count === 0) return null;
      await tx.project.update({
        where: { id: file.projectId },
        data: {
          reservedBytes: { decrement: file.reservationBytes },
          usedBytes: { increment: sizeBytes },
        },
      });
      return tx.storedFile.findUniqueOrThrow({ where: { id } });
    });
  }

  async markAbandoned(id: string): Promise<boolean> {
    const result = await this.prisma.storedFile.updateMany({
      where: { id, status: 'UPLOADING' },
      data: { status: 'ABANDONED' },
    });
    return result.count > 0;
  }

  releaseAbandoned(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findUnique({ where: { id } });
      if (!file || file.status !== 'ABANDONED') return false;
      const removed = await tx.storedFile.deleteMany({
        where: { id, status: 'ABANDONED' },
      });
      if (removed.count === 0) return false;
      await tx.project.update({
        where: { id: file.projectId },
        data: { reservedBytes: { decrement: file.reservationBytes } },
      });
      return true;
    });
  }

  listStale(now = new Date()) {
    return this.prisma.storedFile.findMany({
      where: {
        OR: [
          { status: 'ABANDONED' },
          { status: 'UPLOADING', expiresAt: { lte: now } },
        ],
      },
      select: { id: true, storageKey: true, status: true },
    });
  }
}
