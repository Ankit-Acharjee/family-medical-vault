import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Patch,
  Req,
  Res,
  UseGuards,
  HttpException,
  SetMetadata,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { BeginUpload } from '@fmv/contracts';
import {
  maximumDocumentBytes,
  maximumExtractionRequestBytes,
} from '@fmv/contracts';
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
  @Get('documents/:documentId/extraction/context')
  async extractionContext(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
  ) {
    const result = await this.documents.extraction.read(
      await this.principal(req),
      p,
      d,
      false,
    );
    return { context: result.context };
  }
  @Get('documents/:documentId/extraction')
  async savedExtraction(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
  ) {
    return this.documents.extraction.read(await this.principal(req), p, d);
  }
  @Put('documents/:documentId/extraction')
  async saveExtraction(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
  ) {
    const principal = await this.principal(req);
    await this.documents.extraction.read(principal, p, d, false, true);
    if (Number(req.headers['content-length']) > maximumExtractionRequestBytes)
      throw new HttpException('Too large', 413);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += b.length;
      if (size > maximumExtractionRequestBytes)
        throw new HttpException('Too large', 413);
      chunks.push(b);
    }
    let body: unknown;
    try {
      body = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new BadRequestException();
    }
    return this.documents.extraction.save(principal, p, d, body);
  }
  @Get('documents') async list(
    @Req() req: Request,
    @Param('patientId') p: string,
  ) {
    return this.documents.list(await this.principal(req), p);
  }
  @Get('trash') async listTrash(
    @Req() req: Request,
    @Param('patientId') p: string,
  ) {
    return this.documents.listTrash(await this.principal(req), p);
  }
  @Post('documents/:documentId/trash')
  @HttpCode(200)
  async trash(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
    @Body() body: unknown,
  ) {
    return this.documents.changeTrash(
      await this.principal(req),
      p,
      d,
      'trash',
      body,
    );
  }
  @Post('documents/:documentId/restore')
  @HttpCode(200)
  async restore(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
    @Body() body: unknown,
  ) {
    return this.documents.changeTrash(
      await this.principal(req),
      p,
      d,
      'restore',
      body,
    );
  }
  @Get('categories') async categories(
    @Req() req: Request,
    @Param('patientId') p: string,
  ) {
    return this.documents.categories(await this.principal(req), p);
  }
  @Patch('documents/:documentId/title') async rename(
    @Req() req: Request,
    @Param('patientId') p: string,
    @Param('documentId') d: string,
    @Body() body: unknown,
  ) {
    return this.documents.rename(await this.principal(req), p, d, body);
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
