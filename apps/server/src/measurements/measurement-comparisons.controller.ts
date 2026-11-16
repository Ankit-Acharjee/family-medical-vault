import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { MeasurementComparisonsService } from './measurement-comparisons.service.js';
@Controller('api/patients/:patientId/measurement-comparisons/:setId')
@UseGuards(AuthBoundaryGuard)
export class MeasurementComparisonsController {
  constructor(
    private readonly auth: AuthService,
    private readonly comparisons: MeasurementComparisonsService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  @Get() async read(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('setId') id: string,
  ) {
    return this.comparisons.read(await this.principal(req), p, id);
  }
  @Put() async confirm(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('setId') id: string,
    @Body() body: unknown,
  ) {
    return this.comparisons.confirm(await this.principal(req), p, id, body);
  }
  @Post('withdraw') @HttpCode(200) async withdraw(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('setId') id: string,
    @Body() body: unknown,
  ) {
    return this.comparisons.withdraw(await this.principal(req), p, id, body);
  }
}
