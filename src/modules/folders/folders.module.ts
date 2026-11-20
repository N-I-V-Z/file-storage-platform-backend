import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { FoldersController } from './folders.controller.js';
import { FoldersRepository } from './folders.repository.js';
import { FoldersService } from './folders.service.js';

@Module({
  imports: [DatabaseModule, ProjectsModule],
  controllers: [FoldersController],
  providers: [FoldersRepository, FoldersService],
  exports: [FoldersService],
})
export class FoldersModule {}
