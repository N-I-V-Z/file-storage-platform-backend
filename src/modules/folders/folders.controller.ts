import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthPrincipal } from '../auth/auth.guard.js';
import { FolderNameDto } from './dto/folder-name.dto.js';
import { FoldersService } from './folders.service.js';

@Controller('projects/:projectId/folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() body: FolderNameDto,
  ) {
    return this.folders.create(user.userId, projectId, body.name);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return this.folders.list(user.userId, projectId);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: FolderNameDto,
  ) {
    return this.folders.rename(user.userId, projectId, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.folders.remove(user.userId, projectId, id);
  }
}
