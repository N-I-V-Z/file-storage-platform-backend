import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { ClamdScanner } from './clamd-scanner.js';
import { MALWARE_SCANNER } from './scanner-adapter.js';

@Module({
  imports: [StorageModule],
  providers: [{ provide: MALWARE_SCANNER, useClass: ClamdScanner }],
  exports: [MALWARE_SCANNER],
})
export class ScannerModule {}
