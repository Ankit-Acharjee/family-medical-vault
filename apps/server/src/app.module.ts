import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AuthService } from './auth/auth.service.js';

import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import type { PersonStore } from './identity/person.store.js';
import type { AccessStore } from './access/access.store.js';
import type { DocumentsService } from './documents/documents.service.js';

@Module({
  imports: [HealthModule],
})
export class AppModule {
  static register(
    auth?: AuthService,
    people?: PersonStore,
    access?: AccessStore,
    documents?: DocumentsService,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [AuthModule.register(auth, people, access, documents)],
    };
  }
}
