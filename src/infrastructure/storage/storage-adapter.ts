import type { WriteStream } from 'node:fs';

export interface StorageAdapter {
  init(): Promise<void>;
  createTemporary(id: string): WriteStream;
  objectPath(id: string): string;
  promote(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  freeBytes(): Promise<bigint>;
}
