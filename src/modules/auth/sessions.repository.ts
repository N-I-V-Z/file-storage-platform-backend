import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ) {
    return this.prisma.session.create({
      data: { id, userId, refreshTokenHash, expiresAt },
    });
  }

  findById(id: string) {
    return this.prisma.session.findUnique({
      where: { id },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  async rotate(
    id: string,
    currentHash: string,
    nextHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: {
        id,
        refreshTokenHash: currentHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        previousRefreshTokenHash: currentHash,
        refreshTokenHash: nextHash,
      },
    });
    return result.count === 1;
  }

  revoke(id: string) {
    return this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
