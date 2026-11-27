import { createReadStream, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  statfs,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { StorageAdapter } from './storage-adapter.js';

const STORAGE_DIRECTORIES = [
  'objects',
  'temporary',
  'quarantine',
  'processing',
] as const;
const FILE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FilesystemStorage implements StorageAdapter {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.requireDirectory(this.root);
    for (const name of STORAGE_DIRECTORIES) {
      const path = join(this.root, name);
      await mkdir(path, { recursive: true, mode: 0o700 });
      await this.requireDirectory(path);
    }
  }

  createTemporary(id: string) {
    return createWriteStream(this.temporaryPath(id), {
      flags: 'wx',
      mode: 0o600,
    });
  }

  openTemporary(id: string) {
    return createReadStream(this.temporaryPath(id), {
      highWaterMark: 64 * 1024,
    });
  }

  objectPath(id: string): string {
    this.requireId(id);
    return join(this.root, 'objects', id.slice(0, 2), id);
  }

  openObject(id: string) {
    return open(this.objectPath(id), 'r');
  }

  async promote(id: string): Promise<void> {
    const objectPath = this.objectPath(id);
    const shard = join(this.root, 'objects', id.slice(0, 2));
    await mkdir(shard, { recursive: true, mode: 0o700 });
    await this.requireDirectory(shard);
    await rename(this.temporaryPath(id), objectPath);
  }

  async remove(id: string): Promise<void> {
    await Promise.all([
      this.unlinkIfExists(this.temporaryPath(id)),
      this.unlinkIfExists(this.objectPath(id)),
    ]);
  }

  async freeBytes(): Promise<bigint> {
    const stats = await statfs(this.root);
    return BigInt(stats.bavail) * BigInt(stats.bsize);
  }

  async temporaryUsage(maxEntries = 10_000): Promise<{
    bytes: bigint;
    files: number;
    truncated: boolean;
  }> {
    let bytes = 0n;
    let files = 0;
    let scannedEntries = 0;
    let truncated = false;
    const directory = await opendir(join(this.root, 'temporary'));
    for await (const entry of directory) {
      if (scannedEntries >= maxEntries) {
        truncated = true;
        break;
      }
      scannedEntries++;
      if (!entry.isFile()) continue;
      try {
        const file = await lstat(join(this.root, 'temporary', entry.name));
        if (file.isFile() && !file.isSymbolicLink()) {
          bytes += BigInt(file.size);
          files++;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return { bytes, files, truncated };
  }

  private temporaryPath(id: string): string {
    this.requireId(id);
    return join(this.root, 'temporary', id);
  }

  private requireId(id: string): void {
    if (!FILE_ID.test(id)) throw new Error('Invalid generated file ID');
  }

  private async requireDirectory(path: string): Promise<void> {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Storage path must be a real directory');
    }
  }

  private async unlinkIfExists(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
