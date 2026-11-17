import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { MedicationReconciliationService } from './medication-reconciliation.service.js';
@Controller('api/patients/:patientId/medication-reconciliations')
@UseGuards(AuthBoundaryGuard)
export class MedicationReconciliationController {
  constructor(
    private readonly auth: AuthService,
    private readonly medications: MedicationReconciliationService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  @Get() async list(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Query() query: unknown,
  ) {
    return this.medications.list(await this.principal(req), p, query);
  }
  @Get('source-options') async sourceOptions(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Query() query: unknown,
  ) {
    return this.medications.sourceOptions(await this.principal(req), p, query);
  }
  @Get(':medicationId') async history(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('medicationId') id: string,
    @Query() query: unknown,
  ) {
    return this.medications.history(await this.principal(req), p, id, query);
  }
  @Put(':medicationId') async save(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('medicationId') id: string,
    @Body() body: unknown,
  ) {
    return this.medications.save(await this.principal(req), p, id, body);
  }
}
