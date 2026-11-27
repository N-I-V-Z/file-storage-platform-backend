import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthPrincipal } from '../auth/auth.guard.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { ShareLinksService } from './share-links.service.js';

@Controller('projects/:projectId/files/:fileId/share-links')
export class ShareLinksController {
  constructor(private readonly links: ShareLinksService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @Body() body: CreateShareLinkDto,
  ) {
    return this.links.create(user.userId, projectId, fileId, body);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ) {
    return this.links.list(user.userId, projectId, fileId);
  }

  @Delete(':linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @Param('linkId', new ParseUUIDPipe()) linkId: string,
  ) {
    return this.links.revoke(user.userId, projectId, fileId, linkId);
  }
}
