import {
  Controller,
  Get,
  Head,
  Header,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { FileDownloadService } from '../files/file-download.service.js';
import { ShareLinksService } from './share-links.service.js';

@Controller('shared-files')
export class SharedFilesController {
  constructor(
    private readonly links: ShareLinksService,
    private readonly downloads: FileDownloadService,
  ) {}

  @Get('download')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseGuards(ThrottlerGuard)
  @Header('Referrer-Policy', 'no-referrer')
  async download(@Req() request: Request, @Res() response: Response) {
    const file = await this.links.resolve(request.headers.authorization);
    return this.downloads.send(
      request,
      response,
      file.projectId,
      file.id,
      false,
    );
  }

  @Head('download')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseGuards(ThrottlerGuard)
  @Header('Referrer-Policy', 'no-referrer')
  async head(@Req() request: Request, @Res() response: Response) {
    const file = await this.links.resolve(request.headers.authorization);
    return this.downloads.send(
      request,
      response,
      file.projectId,
      file.id,
      true,
    );
  }
}
