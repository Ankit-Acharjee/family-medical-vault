import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthService } from './auth/auth.service.js';

import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [HealthModule],
})
export class AppModule {
  static register(auth?: AuthService): DynamicModule {
    return { module: AppModule, imports: [AuthModule.register(auth)] };
  }
}
