import { Controller, Get } from '@nestjs/common';
import { Public } from './common.js';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health(): { status: string } {
    return { status: 'ok' };
  }
}
