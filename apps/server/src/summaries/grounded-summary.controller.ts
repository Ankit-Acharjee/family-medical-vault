import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { GroundedSummaryService } from './grounded-summary.service.js';
@Controller('api/patients/:patientId/summary')
@UseGuards(AuthBoundaryGuard)
export class GroundedSummaryController {
  constructor(
    private readonly auth: AuthService,
    private readonly summaries: GroundedSummaryService,
  ) {}
  @Get() async read(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Query() query: unknown,
  ) {
    const principal = await this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
    return this.summaries.read(principal, p, query);
  }
}
