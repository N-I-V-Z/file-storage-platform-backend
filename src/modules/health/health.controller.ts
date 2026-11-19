import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  readiness() {
    return this.health.readiness();
  }
}
