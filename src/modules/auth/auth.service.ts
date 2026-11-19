import { randomBytes, randomUUID, createHmac } from 'node:crypto';
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
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId, typ: 'access' },
      {
        secret: this.config.getOrThrow('jwtAccessSecret'),
        issuer: 'file-storage-platform',
        audience: 'file-storage-web',
        expiresIn: '15m',
      },
    );
    const refreshTokenHash = createHmac(
      'sha256',
      this.config.getOrThrow('jwtRefreshSecret'),
    )
      .update(refreshSecret)
      .digest('hex');
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
}
