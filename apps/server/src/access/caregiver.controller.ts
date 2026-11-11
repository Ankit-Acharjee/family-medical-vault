import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { CaregiverService } from './caregiver.service.js';
import { ProposalError } from './invitation.js';

function token(body: unknown): string {
  if (
    !body ||
    typeof body !== 'object' ||
    Object.keys(body).length !== 1 ||
    !('token' in body) ||
    typeof body.token !== 'string'
  )
    throw new BadRequestException();
  return body.token;
}
function empty(body: unknown) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length
  )
    throw new BadRequestException();
}
@Controller('api')
@UseGuards(AuthBoundaryGuard)
export class CaregiverController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: CaregiverService,
  ) {}
  private principal(req: Request) {
    return this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
  }
  private async operation<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (e) {
      if (e instanceof ProposalError)
        throw new HttpException('Invalid access proposal', 400);
      throw e;
    }
  }
  @Get('patients/:patientId/access') async list(
    @Req() req: Request,
    @Param('patientId') p: string,
  ) {
    return this.access.list(await this.principal(req), p);
  }
  @Post('patients/:patientId/access/invitations') async create(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    const a = await this.principal(req);
    return this.operation(() => this.access.create(a, p, body));
  }
  @Post('access/requests') async request(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const a = await this.principal(req);
    return this.operation(() => this.access.create(a, null, body));
  }
  @Post('access/inspect') async inspect(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.access.inspect(await this.principal(req), token(body));
  }
  @Post('access/claim') async claim(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.access.claim(await this.principal(req), token(body));
  }
  @Post('patients/:patientId/access/invitations/:id/approve') async approve(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    empty(body);
    return this.access.approve(await this.principal(req), p, id);
  }
  @Post('patients/:patientId/access/requests/approve') async approveRequest(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    return this.access.approve(await this.principal(req), p, token(body), true);
  }
  @Post('patients/:patientId/access/invitations/:id/revoke')
  async revokeInvitation(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    empty(body);
    return this.access.revoke(await this.principal(req), p, id, true);
  }
  @Post('patients/:patientId/access/grants/:id/revoke') async revokeGrant(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    empty(body);
    return this.access.revoke(await this.principal(req), p, id);
  }
}
