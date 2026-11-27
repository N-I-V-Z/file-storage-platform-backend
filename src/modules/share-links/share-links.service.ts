import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShareLinksRepository } from './share-links.repository.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';

const DEFAULT_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_LIFETIME_MS = 7 * DEFAULT_LIFETIME_MS;

@Injectable()
export class ShareLinksService {
  constructor(private readonly links: ShareLinksRepository) {}

  async create(
    ownerId: string,
    projectId: string,
    fileId: string,
    input: CreateShareLinkDto,
  ) {
    const now = new Date();
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : new Date(now.getTime() + DEFAULT_LIFETIME_MS);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt <= now ||
      expiresAt.getTime() > now.getTime() + MAX_LIFETIME_MS
    )
      throw new BadRequestException(
        'Share link expiry must be within seven days',
      );
    const token = `fsps_${randomBytes(32).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const link = await this.links.create(
      ownerId,
      projectId,
      fileId,
      tokenHash,
      expiresAt,
    );
    if (!link) throw new NotFoundException('Shareable file not found');
    return { ...link, token };
  }

  async list(ownerId: string, projectId: string, fileId: string) {
    const links = await this.links.list(ownerId, projectId, fileId);
    if (!links) throw new NotFoundException('File not found');
    return links;
  }

  async revoke(ownerId: string, projectId: string, fileId: string, id: string) {
    if (!(await this.links.revoke(ownerId, projectId, fileId, id)))
      throw new NotFoundException('Share link not found');
  }

  async resolve(authorization: string | undefined) {
    const match = /^Share (fsps_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match) throw new NotFoundException('Share link not found');
    const tokenHash = createHash('sha256').update(match[1]).digest('hex');
    const link = await this.links.findActive(tokenHash, new Date());
    if (!link) throw new NotFoundException('Share link not found');
    return link.file;
  }
}
