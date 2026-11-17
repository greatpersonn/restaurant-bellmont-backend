import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiController, AuthController } from './api.controller.js';
import { Database } from './database.js';
import { JwtGuard, RolesGuard } from './common.js';
import { HealthController } from './health.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  controllers: [HealthController, AuthController, ApiController],
  providers: [
    Database,
    RealtimeGateway,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
