import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service.js';
import { FoldersRepository } from './folders.repository.js';

function databaseCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return undefined;
}

@Injectable()
export class FoldersService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly folders: FoldersRepository,
  ) {}

  async create(ownerId: string, projectId: string, name: string) {
    await this.projects.get(ownerId, projectId);
    try {
      return await this.folders.create(projectId, name);
    } catch (error) {
      if (['P2002', '23505'].includes(databaseCode(error) ?? '')) {
        throw new ConflictException('Folder name already exists');
      }
      throw error;
    }
  }

  async list(ownerId: string, projectId: string) {
    await this.projects.get(ownerId, projectId);
    return this.folders.list(projectId);
  }

  async rename(ownerId: string, projectId: string, id: string, name: string) {
    await this.projects.get(ownerId, projectId);
    try {
      const folder = await this.folders.rename(projectId, id, name);
      if (!folder) throw new NotFoundException('Folder not found');
      return folder;
    } catch (error) {
      if (['P2002', '23505'].includes(databaseCode(error) ?? '')) {
        throw new ConflictException('Folder name already exists');
      }
      throw error;
    }
  }

  async remove(ownerId: string, projectId: string, id: string) {
    await this.projects.get(ownerId, projectId);
    let outcome: 'deleted' | 'has-files' | 'not-found';
    try {
      outcome = await this.folders.remove(projectId, id);
    } catch (error) {
      if (['P2003', '23503'].includes(databaseCode(error) ?? '')) {
        throw new ConflictException('Folder contains files');
      }
      throw error;
    }
    if (outcome === 'not-found')
      throw new NotFoundException('Folder not found');
    if (outcome === 'has-files')
      throw new ConflictException('Folder contains files');
  }
}
