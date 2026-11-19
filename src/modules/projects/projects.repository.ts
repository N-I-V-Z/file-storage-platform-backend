import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const projectFields = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, name: string) {
    return this.prisma.project.create({
      data: { ownerId, name },
      select: projectFields,
    });
  }

  list(ownerId: string) {
    return this.prisma.project.findMany({
      where: { ownerId },
      select: projectFields,
      orderBy: { createdAt: 'desc' },
    });
  }

  findOwned(ownerId: string, id: string) {
    return this.prisma.project.findFirst({
      where: { id, ownerId },
      select: projectFields,
    });
  }

  async renameOwned(ownerId: string, id: string, name: string) {
    const result = await this.prisma.project.updateMany({
      where: { id, ownerId },
      data: { name },
    });
    if (result.count === 0) return null;
    return this.findOwned(ownerId, id);
  }

  async deleteOwned(ownerId: string, id: string) {
    const result = await this.prisma.project.deleteMany({
      where: { id, ownerId },
    });
    return result.count > 0;
  }
}
