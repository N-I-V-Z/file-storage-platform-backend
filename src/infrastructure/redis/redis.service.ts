import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { ValidatedEnvironment } from '../../config/env.validation.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client;

  constructor(config: ConfigService<ValidatedEnvironment, true>) {
    this.client = createClient({
      url: config.getOrThrow('redisUrl'),
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    this.client.on('error', () => {
      // Readiness reports availability without exposing connection details.
    });
  }

  async ping(): Promise<void> {
    if (!this.client.isOpen) await this.client.connect();
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }
}
