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
import { AccessStore, PrismaAccessStore } from '../access/access.store.js';
import { PermissionService } from '../access/permission.service.js';
import { PatientsController } from '../access/patients.controller.js';
import { DocumentsController } from '../documents/documents.controller.js';
import { DocumentsService } from '../documents/documents.service.js';
import {
  DocumentStore,
  PrismaDocumentStore,
} from '../documents/document.store.js';
import {
  UnavailableObjectStore,
  OBJECT_STORE,
} from '../documents/object-store.js';
import type { ObjectStore } from '../documents/object-store.js';
import { R2ObjectStore } from '../documents/r2-object-store.js';
import { storageConfig } from '../documents/storage.config.js';
import { CaregiverController } from '../access/caregiver.controller.js';
import { CaregiverService } from '../access/caregiver.service.js';

class DisabledDocumentStore extends DocumentStore {
  async readExtraction(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async saveExtraction(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  asActor(): never {
    throw new ServiceUnavailableException();
  }
  async list(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async categories(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async audit(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async listTrash(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async changeTrash(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async rename(): Promise<never> {
    throw new ServiceUnavailableException();
  }
}

class DisabledPersonStore extends PersonStore {
  async find(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async create(): Promise<never> {
    throw new ServiceUnavailableException();
  }
}
class DisabledAccessStore extends AccessStore {
  async load(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async list(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async document(): Promise<never> {
    throw new ServiceUnavailableException();
  }
  async category(): Promise<never> {
    throw new ServiceUnavailableException();
  }
}

@Module({
  controllers: [
    AuthController,
    PatientsController,
    DocumentsController,
    CaregiverController,
  ],
  providers: [
    AuthBoundaryGuard,
    PermissionService,
    {
      provide: OBJECT_STORE,
      useFactory: () => {
        const config = storageConfig();
        return config
          ? new R2ObjectStore(config)
          : new UnavailableObjectStore();
      },
    },
    {
      provide: CaregiverService,
      useFactory: () => new CaregiverService(authConfig()?.databaseUrl ?? null),
    },
    {
      provide: DocumentStore,
      useFactory: () => {
        const config = authConfig();
        return config
          ? new PrismaDocumentStore(config.databaseUrl)
          : new DisabledDocumentStore();
      },
    },
    {
      provide: DocumentsService,
      inject: [PermissionService, DocumentStore, OBJECT_STORE],
      useFactory: (
        permissions: PermissionService,
        store: DocumentStore,
        objects: ObjectStore,
      ) => new DocumentsService(permissions, store, objects),
    },
    {
      provide: AccessStore,
      useFactory: () => {
        const config = authConfig();
        return config
          ? new PrismaAccessStore(config.databaseUrl)
          : new DisabledAccessStore();
      },
    },
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
  static register(
    auth?: AuthService,
    people?: PersonStore,
    access?: AccessStore,
    documents?: DocumentsService,
  ): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        ...(auth ? [{ provide: AuthService, useValue: auth }] : []),
        ...(people ? [{ provide: PersonStore, useValue: people }] : []),
        ...(access ? [{ provide: AccessStore, useValue: access }] : []),
        ...(documents
          ? [{ provide: DocumentsService, useValue: documents }]
          : []),
      ],
    };
  }
}
