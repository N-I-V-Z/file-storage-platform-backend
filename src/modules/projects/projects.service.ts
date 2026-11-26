import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsRepository } from './projects.repository.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly projects: ProjectsRepository) {}

  create(ownerId: string, name: string) {
    return this.projects.create(ownerId, name);
  }

  list(ownerId: string) {
    return this.projects.list(ownerId);
  }

  async get(ownerId: string, id: string) {
    const project = await this.projects.findOwned(ownerId, id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async getUsage(ownerId: string, id: string) {
    const project = await this.projects.findOwnedUsage(ownerId, id);
    if (!project) throw new NotFoundException('Project not found');
    return {
      projectId: project.id,
      quotaBytes: project.quotaBytes.toString(),
      usedBytes: project.usedBytes.toString(),
      reservedBytes: project.reservedBytes.toString(),
    };
  }

  async rename(ownerId: string, id: string, name: string) {
    const project = await this.projects.renameOwned(ownerId, id, name);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async remove(ownerId: string, id: string) {
    const outcome = await this.projects.deleteOwned(ownerId, id);
    if (outcome === 'not-found')
      throw new NotFoundException('Project not found');
    if (outcome === 'has-files')
      throw new ConflictException('Project contains files');
  }
}
