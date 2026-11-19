import {
  Controller,
  Get,
  Head,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { FileDownloadGuard } from './file-download.guard.js';
import { FileDownloadService } from './file-download.service.js';
import { FileUploadGuard } from './file-upload.guard.js';
import { FilesService } from './files.service.js';

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly downloads: FileDownloadService,
  ) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard, FileUploadGuard)
  upload(
    @Req() request: Request,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.files.upload(request, projectId);
  }

  @Head(':fileId/download')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard, FileDownloadGuard)
  downloadHead(
    @Req() request: Request,
    @Res() response: Response,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ) {
    return this.downloads.send(request, response, projectId, fileId, true);
  }

  @Get(':fileId/download')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard, FileDownloadGuard)
  download(
    @Req() request: Request,
    @Res() response: Response,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ) {
    return this.downloads.send(request, response, projectId, fileId, false);
  }
}
