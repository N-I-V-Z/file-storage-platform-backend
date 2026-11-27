import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'node:net';
import type { ValidatedEnvironment } from '../../config/env.validation.js';

export function pingClamd(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    let reply = Buffer.alloc(0);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('Scanner probe timed out')),
      timeoutMs,
    );
    timer.unref();
    socket.once('connect', () => socket.write('zPING\0'));
    socket.on('error', (error) => finish(error));
    socket.on('close', () => finish(new Error('Scanner probe disconnected')));
    socket.on('data', (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.length > 64)
        return finish(new Error('Scanner probe reply too large'));
      const end = reply.indexOf(0);
      if (end >= 0)
        finish(
          reply.subarray(0, end).toString() === 'PONG'
            ? undefined
            : new Error('Scanner probe rejected'),
        );
    });
  });
}

@Injectable()
export class ClamdProbe {
  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  ping(): Promise<void> {
    return pingClamd(
      this.config.getOrThrow('clamdHost'),
      this.config.getOrThrow('clamdPort'),
    );
  }
}
