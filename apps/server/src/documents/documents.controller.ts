import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
  HttpException,
  SetMetadata,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { BeginUpload } from '@fmv/contracts';
import { maximumDocumentBytes } from '@fmv/contracts';
import { AuthBoundaryGuard, cookie, cookieName } from '../auth/auth.http.js';
import { AuthService } from '../auth/auth.service.js';
import { DocumentsService } from './documents.service.js';
import { IntakeError } from './intake.js';

@Controller('api/patients/:patientId')
@UseGuards(AuthBoundaryGuard)
export class DocumentsController {
  constructor(
    private readonly auth: AuthService,
    private readonly documents: DocumentsService,
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
      if (e instanceof IntakeError)
        throw new HttpException(e.message, e.status);
      throw e;
    }
  }
  @Get('documents') async list(
    @Req() req: Request,
    @Param('patientId') p: string,
  ) {
    return this.documents.list(await this.principal(req), p);
  }
  @Get('categories') async categories(
    @Req() req: Request,
    @Param('patientId') p: string,
  ) {
    return this.documents.categories(await this.principal(req), p);
  }
  @Post('uploads') async begin(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Body() body: BeginUpload,
  ) {
    const principal = await this.principal(req);
    return this.operation(() => this.documents.begin(principal, p, body));
  }
  @Put('uploads/:uploadId/content')
  @SetMetadata('fmv.binaryUpload', true)
  async content(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('uploadId') u: string,
  ) {
    const principal = await this.principal(req);
    // Authenticate/authorize before buffering; no global large-body parser.
    await this.documents.categories(principal, p);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += b.length;
      if (size > maximumDocumentBytes)
        throw new HttpException('Too large', 413);
      chunks.push(b);
    }
    return this.operation(() =>
      this.documents.content(principal, p, u, Buffer.concat(chunks)),
    );
  }
  @Post('uploads/:uploadId/finalize') async finalize(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('uploadId') u: string,
    @Body() body: unknown,
  ) {
    if (!body || typeof body !== 'object' || Object.keys(body).length)
      throw new BadRequestException();
    const principal = await this.principal(req);
    return this.operation(() => this.documents.finalize(principal, p, u));
  }
  @Get('documents/:documentId/preview') async preview(
    @Req() req: Request,
    @Res() res: Response,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
  ) {
    return this.bytes(req, res, p, d, 'view');
  }
  @Get('documents/:documentId/download') async download(
    @Req() req: Request,
    @Res() res: Response,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
  ) {
    return this.bytes(req, res, p, d, 'export');
  }
  private async bytes(
    req: Request,
    res: Response,
    p: string,
    d: string,
    action: 'view' | 'export',
  ) {
    const principal = await this.principal(req);
    const result = await this.operation(() =>
      this.documents.read(principal, p, d, action),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', result.record.mimeType);
    res.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'; frame-ancestors 'none'",
    );
    // Avoid reflecting filenames into response headers. The UI uses its separately
    // authorized title for a local blob download, never a reusable object URL.
    res.setHeader(
      'Content-Disposition',
      `${action === 'export' ? 'attachment' : 'inline'}; filename="medical-document"`,
    );
    res.send(result.bytes);
  }
}
