import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { OriginalExportService } from './original-export.service.js';
@Controller('api/patients/:patientId/exports/originals')
@UseGuards(AuthBoundaryGuard)
export class OriginalExportController {
  constructor(
    private readonly auth: AuthService,
    private readonly originals: OriginalExportService,
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
    return this.originals.prepare(await this.principal(req), p, body);
  }
  @Post() @HttpCode(200) async export(
    @Req() req: Request,
    @Res() res: Response,
    @Param('patientId') p: string,
    @Body() body: unknown,
  ) {
    const principal = await this.principal(req),
      abort = new AbortController(),
      cancel = () => abort.abort(),
      closed = () => {
        if (!res.writableEnded) cancel();
      };
    const deadline = setTimeout(cancel, 60000);
    req.once('aborted', cancel);
    res.once('close', closed);
    try {
      const result = await this.originals.export(
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
        'attachment; filename="family-medical-vault-originals.zip"',
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
