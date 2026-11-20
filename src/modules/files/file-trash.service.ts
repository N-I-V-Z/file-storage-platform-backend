import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service.js';
import { FileListQueryDto } from './dto/file-list-query.dto.js';
import { FilesRepository } from './files.repository.js';

const RETENTION_MS = 30 * 24 * 60 * 60_000;

@Injectable()
export class FileTrashService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly files: FilesRepository,
  ) {}

  async list(ownerId: string, projectId: string, query: FileListQueryDto) {
    await this.projects.get(ownerId, projectId);
    const { items, total } = await this.files.listTrashed(projectId, query);
    return {
      items: items.map((file) => ({
        id: file.id,
        projectId: file.projectId,
        folderId: file.folderId,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes!.toString(),
        status: 'trashed' as const,
        createdAt: file.createdAt,
        trashedAt: file.trashedAt,
        purgeAfter: file.purgeAfter,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async trash(ownerId: string, projectId: string, fileId: string) {
    await this.projects.get(ownerId, projectId);
    const now = new Date();
    const changed = await this.files.trash(
      projectId,
      fileId,
      now,
      new Date(now.getTime() + RETENTION_MS),
    );
    if (!changed) throw new NotFoundException('File not found');
  }

  async restore(ownerId: string, projectId: string, fileId: string) {
    await this.projects.get(ownerId, projectId);
    const file = await this.files.findTrashed(projectId, fileId);
    if (!file) throw new NotFoundException('File not found in trash');
    const now = new Date();
    if (!file.purgeAfter || file.purgeAfter <= now) {
      throw new ConflictException('Trash retention has expired');
    }
    const changed = await this.files.restore(projectId, fileId, now);
    if (!changed) throw new ConflictException('File can no longer be restored');
    return { id: fileId, status: 'ready' as const };
  }
}
