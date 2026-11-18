import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { TemporaryLinksService } from './temporary-links.service.js';
@Controller('api/patients/:patientId/sharing-links')
@UseGuards(AuthBoundaryGuard)
export class TemporaryLinksController {
  constructor(
    private readonly auth: AuthService,
    private readonly links: TemporaryLinksService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  @Post('prepare') @HttpCode(200) async prepare(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    return this.links.prepare(await this.principal(req), p, body);
  }
  @Post() @HttpCode(200) async create(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    return this.links.create(await this.principal(req), p, body);
  }
  @Get() async list(@Req() req: Request, @Param('patientId') p: string) {
    return this.links.list(await this.principal(req), p);
  }
  @Get(':linkId/activity') async activity(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('linkId') id: string,
  ) {
    return this.links.activity(await this.principal(req), p, id);
  }
  @Post(':linkId/revoke') @HttpCode(200) async revoke(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('linkId') id: string,
  ) {
    return this.links.revoke(await this.principal(req), p, id);
  }
}
