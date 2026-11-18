import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { EmergencyProfileService } from './emergency-profile.service.js';
@Controller('api/patients/:patientId/emergency-profile')
@UseGuards(AuthBoundaryGuard)
export class EmergencyProfileController {
  constructor(
    private readonly auth: AuthService,
    private readonly profiles: EmergencyProfileService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  @Get() async read(@Req() req: Request, @Param('patientId') p: string) {
    return this.profiles.read(await this.principal(req), p);
  }
  @Put() async save(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    return this.profiles.save(await this.principal(req), p, body);
  }
}
