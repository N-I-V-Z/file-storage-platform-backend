import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './modules/auth/public.decorator.js';

@Controller({ version: VERSION_NEUTRAL })
@Public()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
