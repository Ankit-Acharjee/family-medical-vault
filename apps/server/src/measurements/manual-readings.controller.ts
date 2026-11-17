import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { ManualReadingsService } from './manual-readings.service.js';
@Controller('api/patients/:patientId/manual-readings')
@UseGuards(AuthBoundaryGuard)
export class ManualReadingsController {
  constructor(
    private readonly auth: AuthService,
    private readonly readings: ManualReadingsService,
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
    return this.readings.list(await this.principal(req), p, query);
  }
  @Get(':readingId') async history(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('readingId') id: string,
    @Query() query: unknown,
  ) {
    return this.readings.history(await this.principal(req), p, id, query);
  }
  @Put(':readingId') async save(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('readingId') id: string,
    @Body() body: unknown,
  ) {
    return this.readings.save(await this.principal(req), p, id, body);
  }
  @Post(':readingId/withdraw') @HttpCode(200) async withdraw(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('readingId') id: string,
    @Body() body: unknown,
  ) {
    return this.readings.withdraw(await this.principal(req), p, id, body);
  }
}
