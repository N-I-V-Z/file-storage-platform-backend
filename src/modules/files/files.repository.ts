import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { FileListQueryDto } from './dto/file-list-query.dto.js';

@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listReady(projectId: string, query: FileListQueryDto) {
    const where: Prisma.StoredFileWhereInput = {
      projectId,
      status: 'READY',
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
        },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.storedFile.count({ where }),
    ]);
    return { items, total };
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
