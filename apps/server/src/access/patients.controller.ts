import { ManagedProfilesService } from '../identity/managed-profiles.service.js';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { PermissionService } from './permission.service.js';

@ApiTags('Patients')
@Controller('api/patients')
@UseGuards(AuthBoundaryGuard)
export class PatientsController {
  constructor(
    private readonly auth: AuthService,
    private readonly permissions: PermissionService,
    private readonly managed: ManagedProfilesService,
  ) {}
  @Post('managed') @HttpCode(200) async createManaged(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const principal = await this.auth.principal(
      cookie(request, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
    return this.managed.create(principal, body);
  }
  @Get()
  async list(@Req() request: Request) {
    const principal = await this.auth.principal(
      cookie(request, cookieName(this.auth.config!.secure, 'session')),
    );
    return this.permissions.patients(principal);
  }
}
