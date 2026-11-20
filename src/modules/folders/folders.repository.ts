import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class FoldersRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(projectId: string, name: string) {
    return this.prisma.folder.create({
      data: { projectId, name },
    });
  }

  list(projectId: string) {
    return this.prisma.folder.findMany({
      where: { projectId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  find(projectId: string, id: string) {
    return this.prisma.folder.findFirst({ where: { id, projectId } });
  }

  async rename(projectId: string, id: string, name: string) {
    const updated = await this.prisma.folder.updateMany({
      where: { id, projectId },
      data: { name },
    });
    if (updated.count === 0) return null;
    return this.find(projectId, id);
  }

  async remove(projectId: string, id: string) {
    const deleted = await this.prisma.folder.deleteMany({
      where: { id, projectId, files: { none: {} } },
    });
    if (deleted.count > 0) return 'deleted' as const;
    return (await this.find(projectId, id))
      ? ('has-files' as const)
      : ('not-found' as const);
  }
}
