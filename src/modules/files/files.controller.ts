import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { FileUploadGuard } from './file-upload.guard.js';
import { FilesService } from './files.service.js';

@Controller('projects/:projectId/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

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
}
