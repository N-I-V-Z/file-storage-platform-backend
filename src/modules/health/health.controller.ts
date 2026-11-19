import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller()
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
