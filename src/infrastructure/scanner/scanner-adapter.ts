export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

export interface MalwareScanner {
  scan(storageKey: string, signal: AbortSignal): Promise<'clean' | 'infected'>;
}
