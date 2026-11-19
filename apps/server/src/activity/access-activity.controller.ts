import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { AccessActivityService } from './access-activity.service.js';
@Controller('api/patients/:patientId/access-activity')
@UseGuards(AuthBoundaryGuard)
export class AccessActivityController {
  constructor(
    private readonly auth: AuthService,
    private readonly activity: AccessActivityService,
  ) {}
  @Get() async read(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).some((k) => k !== 'cursor'))
      throw new BadRequestException();
    return this.activity.read(
      await this.auth.principal(
        cookie(req, cookieName(this.auth.config!.secure, 'session')),
        true,
      ),
      p,
      query.cursor,
    );
  }
}
