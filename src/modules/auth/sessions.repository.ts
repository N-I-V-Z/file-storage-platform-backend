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
      include: { user: { select: { id: true, email: true, role: true } } },
    });
  }

  async wasConsumed(sessionId: string, tokenHash: string): Promise<boolean> {
    const consumed = await this.prisma.consumedRefreshToken.findUnique({
      where: { sessionId_tokenHash: { sessionId, tokenHash } },
      select: { tokenHash: true },
    });
    return consumed !== null;
  }

  async rotate(
    id: string,
    currentHash: string,
    nextHash: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.session.updateMany({
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
      if (result.count !== 1) return false;
      await transaction.consumedRefreshToken.create({
        data: { sessionId: id, tokenHash: currentHash },
      });
      return true;
    });
  }

  revoke(id: string) {
    return this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
