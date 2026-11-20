import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { FilesRepository } from './files.repository.js';
import { FileTrashService } from './file-trash.service.js';

@Injectable()
export class FileTrashReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(FileTrashReconciler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly files: FilesRepository,
    private readonly trash: FileTrashService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.getOrThrow('nodeEnv') === 'test') return;
    await this.run();
    this.timer = setInterval(() => {
      void this.run().catch(() =>
        this.logger.error('Trash reconciliation query failed'),
      );
    }, 10 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const candidates = await this.files.listPurgeCandidates(now);
      for (const file of candidates) {
        try {
          if (
            file.status === 'TRASHED' &&
            !(await this.files.claimExpired(file.id, now))
          ) {
            continue;
          }
          await this.trash.processPurge(file.id);
        } catch {
          await this.files.touchPurgeAttempt(file.id).catch(() => undefined);
          this.logger.error(`Could not reconcile trash ${file.id}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
