import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
  @Post('export') @HttpCode(200) async export(
    @Req() req: Request,
    @Res() res: Response,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    const principal = await this.auth.principal(
      cookie(req, cookieName(this.auth.config!.secure, 'session')),
      true,
    );
    const abort = new AbortController(),
      cancel = () => abort.abort(),
      closed = () => {
        if (!res.writableEnded) cancel();
      };
    const deadline = setTimeout(cancel, 30000);
    req.once('aborted', cancel);
    res.once('close', closed);
    try {
      const result = await this.summaries.export(
        principal,
        p,
        body,
        abort.signal,
      );
      abort.signal.throwIfAborted();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="family-medical-vault-summary.zip"',
      );
      res.setHeader(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; frame-ancestors 'none'",
      );
      res.send(result.bytes);
    } finally {
      clearTimeout(deadline);
      req.removeListener('aborted', cancel);
      res.removeListener('close', closed);
    }
  }
}
