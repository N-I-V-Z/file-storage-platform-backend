import type { WriteStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');

export interface StorageAdapter {
  init(): Promise<void>;
  createTemporary(id: string): WriteStream;
  objectPath(id: string): string;
  openObject(id: string): Promise<FileHandle>;
  promote(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  freeBytes(): Promise<bigint>;
}
