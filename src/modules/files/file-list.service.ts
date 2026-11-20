import { Injectable } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service.js';
import { FileListQueryDto } from './dto/file-list-query.dto.js';
import { FilesRepository } from './files.repository.js';

@Injectable()
export class FileListService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly files: FilesRepository,
  ) {}

  async list(ownerId: string, projectId: string, query: FileListQueryDto) {
    await this.projects.get(ownerId, projectId);
    const { items, total } = await this.files.listReady(projectId, query);
    return {
      items: items.map((file) => ({
        id: file.id,
        projectId: file.projectId,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes!.toString(),
        sha256: file.sha256,
        status: 'ready' as const,
        createdAt: file.createdAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
