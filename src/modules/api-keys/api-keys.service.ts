import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysRepository } from './api-keys.repository.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import type { ApiKeyScope } from './api-key-scopes.js';

@Injectable()
export class ApiKeysService {
  constructor(private readonly keys: ApiKeysRepository) {}

  private async requireOwned(ownerId: string, projectId: string) {
    const project = await this.keys.findOwnedProject(ownerId, projectId);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async issue(ownerId: string, projectId: string, input: CreateApiKeyDto) {
    await this.requireOwned(ownerId, projectId);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date())
      throw new BadRequestException('Expiry must be in the future');
    const id = randomUUID();
    const token = `fsp_${id}_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const key = await this.keys.create({
      id,
      projectId,
      name: input.name,
      tokenHash,
      scopes: input.scopes,
      expiresAt,
    });
    return { ...key, token };
  }

  async list(ownerId: string, projectId: string) {
    await this.requireOwned(ownerId, projectId);
    return this.keys.list(projectId);
  }

  async revoke(ownerId: string, projectId: string, id: string) {
    await this.requireOwned(ownerId, projectId);
    if (!(await this.keys.revoke(projectId, id)))
      throw new NotFoundException('API key not found');
  }

  async verify(token: string, projectId: string, scope: ApiKeyScope) {
    const match =
      /^fsp_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/.exec(
        token,
      );
    if (!match) throw new UnauthorizedException('Invalid API key');
    const key = await this.keys.findForVerification(match[1]);
    const digest = createHash('sha256').update(token).digest();
    if (
      !key ||
      !/^[0-9a-f]{64}$/.test(key.tokenHash) ||
      !timingSafeEqual(digest, Buffer.from(key.tokenHash, 'hex')) ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt <= new Date())
    ) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (key.projectId !== projectId || !key.scopes.includes(scope))
      throw new ForbiddenException('API key lacks access');
    if (!(await this.keys.touchIfActive(key.id))) {
      throw new UnauthorizedException('Invalid API key');
    }
    return key.project;
  }
}
