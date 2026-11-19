import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

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
