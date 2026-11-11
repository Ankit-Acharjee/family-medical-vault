import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './common/http-error.filter.js';
import { requestContext } from './common/request-context.js';
import type { RequestLog } from './common/request-context.js';
import type { AuthService } from './auth/auth.service.js';
import type { PersonStore } from './identity/person.store.js';
import type { AccessStore } from './access/access.store.js';
import type { DocumentsService } from './documents/documents.service.js';

export async function createApplication(
  options: {
    log?: RequestLog;
    docs?: boolean;
    auth?: AuthService;
    people?: PersonStore;
    access?: AccessStore;
    documents?: DocumentsService;
  } = {},
) {
  // Nest's default logger can include exception details. All HTTP logging is allowlisted.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(
      options.auth,
      options.people,
      options.access,
      options.documents,
    ),
    {
      logger: false,
      abortOnError: false,
    },
  );
  app.disable('x-powered-by');
  app.use(
    requestContext(
      options.log ??
        ((event) => process.stdout.write(`${JSON.stringify(event)}\n`)),
    ),
  );
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Family Medical Vault API')
      .setDescription(
        'API foundation. Health reports process liveness, not dependency readiness.',
      )
      .setVersion('0.0.0')
      .build(),
  );
  if (options.docs ?? process.env['NODE_ENV'] !== 'production') {
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: '/api/openapi.json',
    });
  }
  return { app, document };
}
