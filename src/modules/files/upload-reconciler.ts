import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { FilesystemStorage } from '../../infrastructure/storage/filesystem-storage.js';
import { QuotasRepository } from '../quotas/quotas.repository.js';

@Injectable()
export class UploadReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(UploadReconciler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly quotas: QuotasRepository,
    private readonly storage: FilesystemStorage,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
    this.timer = setInterval(() => {
      void this.run().catch(() =>
        this.logger.error('Upload reconciliation query failed'),
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
      const stale = await this.quotas.listStale();
      for (const file of stale) {
        try {
          if (
            file.status === 'UPLOADING' &&
            !(await this.quotas.markAbandoned(file.id))
          ) {
            continue;
          }
          await this.storage.remove(file.storageKey);
          await this.quotas.releaseAbandoned(file.id);
        } catch {
          this.logger.error(`Could not reconcile upload ${file.id}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
