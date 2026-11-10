import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { authConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthBoundaryGuard } from './auth.http.js';
import { AuthService } from './auth.service.js';
import { PrismaAuthStore } from './auth.store.js';
import { SupabaseProvider } from './supabase.provider.js';
import { PersonStore, PrismaPersonStore } from '../identity/person.store.js';
import { ServiceUnavailableException } from '@nestjs/common';

class DisabledPersonStore extends PersonStore {
  async find(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async create(): Promise<never> {
    throw new ServiceUnavailableException();
  }
}

@Module({
  controllers: [AuthController],
  providers: [
    AuthBoundaryGuard,
    {
      provide: PersonStore,
      useFactory: () => {
        const config = authConfig();
        return config
          ? new PrismaPersonStore(config.databaseUrl)
          : new DisabledPersonStore();
      },
    },
    {
      provide: AuthService,
      useFactory: () => {
        const config = authConfig();
        return new AuthService(
          config,
          config ? new PrismaAuthStore(config.databaseUrl) : null,
          config ? new SupabaseProvider(config) : null,
        );
      },
    },
  ],
})
export class AuthModule {
  static register(auth?: AuthService, people?: PersonStore): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        ...(auth ? [{ provide: AuthService, useValue: auth }] : []),
        ...(people ? [{ provide: PersonStore, useValue: people }] : []),
      ],
    };
  }
}
