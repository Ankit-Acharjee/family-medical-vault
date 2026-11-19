import {
  BadRequestException,
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
import { ProfileActivationService } from './profile-activation.service.js';
import { validOpaque } from '../auth/auth.crypto.js';
function capability(body: unknown, claim = false) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== (claim ? 2 : 1) ||
    !('token' in body) ||
    !validOpaque(body.token) ||
    (claim && (!('confirmed' in body) || body.confirmed !== true))
  )
    throw new BadRequestException();
  return body.token;
}
@Controller('api/patients/:patientId/activations')
@UseGuards(AuthBoundaryGuard)
export class ProfileActivationController {
  constructor(
    private readonly auth: AuthService,
    private readonly service: ProfileActivationService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  @Get() async list(@Req() req: Request, @Param('patientId') p: string) {
    return this.service.list(await this.principal(req), p);
  }
  @Post() @HttpCode(200) async issue(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    return this.service.issue(await this.principal(req), p, body);
  }
  @Post(':id/revoke') @HttpCode(200) async revoke(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('id') id: string,
  ) {
    return this.service.revoke(await this.principal(req), p, id);
  }
  @Post(':id/approve') @HttpCode(200) async approve(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.approve(await this.principal(req), p, id, body);
  }
}
// Verified sign-in is mandatory, but owning a personal Person is deliberately not.
@Controller('api/profile-activation')
@UseGuards(AuthBoundaryGuard)
export class ActivationClaimController {
  constructor(
    private readonly auth: AuthService,
    private readonly service: ProfileActivationService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  @Post('inspect') @HttpCode(200) async inspect(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.inspect(await this.principal(req), capability(body));
  }
  @Post('claim') @HttpCode(200) async claim(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.claim(
      await this.principal(req),
      capability(body, true),
    );
  }
  @Post('status') @HttpCode(200) async status(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.status(await this.principal(req), capability(body));
  }
}
