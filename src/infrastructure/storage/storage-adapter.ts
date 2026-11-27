import type { ReadStream, WriteStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export interface StorageAdapter {
  init(): Promise<void>;
  createTemporary(id: string): WriteStream;
  openTemporary(id: string): ReadStream;
  objectPath(id: string): string;
  openObject(id: string): Promise<FileHandle>;
  promote(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  freeBytes(): Promise<bigint>;
  temporaryUsage(): Promise<{
    bytes: bigint;
    files: number;
    truncated: boolean;
  }>;
}
