import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../config/env.validation.js';
import { AuditRepository } from './audit.repository.js';

@Injectable()
export class AuditReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AuditReconciler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly audit: AuditRepository,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.getOrThrow('nodeEnv') === 'test') return;
    await this.run();
    this.timer = setInterval(() => {
      void this.run().catch(() => this.logger.error('Audit cleanup failed'));
    }, 10 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.audit.deleteExpired(new Date());
    } finally {
      this.running = false;
    }
  }
}
