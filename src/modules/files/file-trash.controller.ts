import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthPrincipal } from '../auth/auth.guard.js';
import { FileListQueryDto } from './dto/file-list-query.dto.js';
import { FileTrashService } from './file-trash.service.js';

@Controller('projects/:projectId')
export class FileTrashController {
  constructor(private readonly trash: FileTrashService) {}

  @Get('trash')
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Query() query: FileListQueryDto,
  ) {
    return this.trash.list(user.userId, projectId, query);
  }

  @Delete('files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  trashFile(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ) {
    return this.trash.trash(user.userId, projectId, fileId);
  }

  @Post('trash/:fileId/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  restore(
    @CurrentUser() user: AuthPrincipal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ) {
    return this.trash.restore(user.userId, projectId, fileId);
  }
}
