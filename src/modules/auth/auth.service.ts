import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { UsersRepository } from '../users/users.repository.js';
import { hashPassword, verifyPassword } from './password.js';
import { SessionsRepository } from './sessions.repository.js';

export const REFRESH_COOKIE_NAME = 'fsp_refresh';
export const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  private hashRefreshToken(secret: string): string {
    return createHmac('sha256', this.config.getOrThrow('jwtRefreshSecret'))
      .update(secret)
      .digest('hex');
  }

  private matchesHash(actual: string, expected: string | null): boolean {
    return expected !== null && /^[0-9a-f]{64}$/.test(expected)
      ? timingSafeEqual(
          Buffer.from(actual, 'hex'),
          Buffer.from(expected, 'hex'),
        )
      : false;
  }

  private issueAccessToken(userId: string, sessionId: string) {
    return this.jwt.signAsync(
      { sub: userId, sid: sessionId, typ: 'access' },
      {
        secret: this.config.getOrThrow('jwtAccessSecret'),
        issuer: 'file-storage-platform',
        audience: 'file-storage-web',
        expiresIn: '15m',
      },
    );
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) {
      await hashPassword(password);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const sessionId = randomUUID();
    const refreshSecret = randomBytes(32).toString('base64url');
    const accessToken = await this.issueAccessToken(user.id, sessionId);
    const refreshTokenHash = this.hashRefreshToken(refreshSecret);
    await this.sessions.create(
      sessionId,
      user.id,
      refreshTokenHash,
      new Date(Date.now() + REFRESH_LIFETIME_MS),
    );

    return {
      accessToken,
      refreshCookie: `${sessionId}.${refreshSecret}`,
      user: { id: user.id, email: user.email },
    };
  }

  async refresh(cookie: string | undefined) {
    const match =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(
        cookie ?? '',
      );
    if (!match) throw new UnauthorizedException('Invalid session');
    const [, sessionId, refreshSecret] = match;
    const session = await this.sessions.findById(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid session');
    }

    const presentedHash = this.hashRefreshToken(refreshSecret);
    if (this.matchesHash(presentedHash, session.previousRefreshTokenHash)) {
      await this.sessions.revoke(sessionId);
      throw new UnauthorizedException('Invalid session');
    }
    if (!this.matchesHash(presentedHash, session.refreshTokenHash)) {
      throw new UnauthorizedException('Invalid session');
    }

    const nextSecret = randomBytes(32).toString('base64url');
    const accessToken = await this.issueAccessToken(session.userId, sessionId);
    const rotated = await this.sessions.rotate(
      sessionId,
      presentedHash,
      this.hashRefreshToken(nextSecret),
    );
    if (!rotated) {
      const latest = await this.sessions.findById(sessionId);
      if (
        latest &&
        this.matchesHash(presentedHash, latest.previousRefreshTokenHash)
      ) {
        await this.sessions.revoke(sessionId);
      }
      throw new UnauthorizedException('Invalid session');
    }

    return {
      accessToken,
      refreshCookie: `${sessionId}.${nextSecret}`,
      user: session.user,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
