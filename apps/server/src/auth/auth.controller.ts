import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import type {
  AuthAccount,
  AuthBootstrap,
  AuthCredentials,
  AuthNotice,
} from '@fmv/contracts';
import { AuthService } from './auth.service.js';
import { PersonStore } from '../identity/person.store.js';
import { Transform } from 'class-transformer';
import {
  AuthBoundaryGuard,
  clearCookie,
  cookie,
  cookieName,
  csrf,
  setCookie,
} from './auth.http.js';

class EmailDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
class LoginDto extends EmailDto implements AuthCredentials {
  @ApiProperty({ writeOnly: true, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
class RegisterDto extends EmailDto {
  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
class ResetDto {
  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
class EmptyDto {}
class CreatePersonDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;
}

@ApiTags('Authentication')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly people: PersonStore,
  ) {}
  private read(request: Request, kind: 'session' | 'flow') {
    return cookie(request, cookieName(this.auth.config?.secure ?? false, kind));
  }
  private readonly notice: AuthNotice = {
    message:
      'If this address is eligible, instructions will arrive by email. Open the link in this browser.',
  };

  @Get('bootstrap')
  bootstrap(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): AuthBootstrap {
    response.setHeader('Referrer-Policy', 'no-referrer');
    return {
      enabled: Boolean(this.auth.config),
      csrf: this.auth.config
        ? csrf(request, response, this.auth.config.secure)
        : null,
    };
  }
  @Get('account')
  @UseGuards(AuthBoundaryGuard)
  account(@Req() request: Request): Promise<AuthAccount> {
    return this.auth.account(this.read(request, 'session'));
  }
  @Get('person')
  @UseGuards(AuthBoundaryGuard)
  async person(@Req() request: Request) {
    const principal = await this.auth.principal(this.read(request, 'session'));
    try {
      return { person: await this.people.find(principal) };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  @Post('person')
  @HttpCode(200)
  @UseGuards(AuthBoundaryGuard)
  async createPerson(@Body() body: CreatePersonDto, @Req() request: Request) {
    const principal = await this.auth.principal(this.read(request, 'session'));
    try {
      return { person: await this.people.create(principal, body.displayName) };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  @Get('recovery')
  @UseGuards(AuthBoundaryGuard)
  async recovery(@Req() request: Request) {
    await this.auth.recovery(this.read(request, 'session'));
    return { ready: true };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(AuthBoundaryGuard)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const id = await this.auth.login(
      body.email.trim().toLowerCase(),
      body.password,
      this.read(request, 'session'),
    );
    setCookie(response, this.auth.config!.secure, 'session', id);
    return { ok: true };
  }
  @Post('register')
  @HttpCode(202)
  @UseGuards(AuthBoundaryGuard)
  async register(
    @Body() body: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.begin(
      'signup',
      body.email.trim().toLowerCase(),
      body.password,
      this.read(request, 'flow'),
    );
    setCookie(
      response,
      this.auth.config!.secure,
      'flow',
      result.id,
      30 * 60_000,
    );
    return this.notice;
  }
  @Post('recover')
  @HttpCode(202)
  @UseGuards(AuthBoundaryGuard)
  async recover(
    @Body() body: EmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.begin(
      'recover',
      body.email.trim().toLowerCase(),
      undefined,
      this.read(request, 'flow'),
    );
    setCookie(
      response,
      this.auth.config!.secure,
      'flow',
      result.id,
      30 * 60_000,
    );
    return this.notice;
  }
  @Post('resend')
  @HttpCode(202)
  @UseGuards(AuthBoundaryGuard)
  async resend(@Body() body: EmailDto, @Req() request: Request) {
    await this.auth.resend(
      this.read(request, 'flow'),
      body.email.trim().toLowerCase(),
    );
    return this.notice;
  }
  @Post('google')
  @HttpCode(200)
  @UseGuards(AuthBoundaryGuard)
  async google(
    @Body() _body: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.begin(
      'google',
      '',
      undefined,
      this.read(request, 'flow'),
    );
    setCookie(
      response,
      this.auth.config!.secure,
      'flow',
      result.id,
      30 * 60_000,
    );
    return { url: result.url };
  }
  @Get('callback')
  @UseGuards(AuthBoundaryGuard)
  async callback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    try {
      const result = await this.auth.callback(
        this.read(request, 'flow'),
        code,
        state,
        this.read(request, 'session'),
      );
      setCookie(response, this.auth.config!.secure, 'session', result.id);
      clearCookie(response, this.auth.config!.secure, 'flow');
      response.redirect(303, result.recovery ? '/#auth-reset' : '/#overview');
    } catch {
      clearCookie(response, this.auth.config!.secure, 'flow');
      response.redirect(303, '/#auth-error');
    }
  }
  @Post('reset')
  @HttpCode(200)
  @UseGuards(AuthBoundaryGuard)
  async reset(
    @Body() body: ResetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      await this.auth.reset(this.read(request, 'session'), body.password);
    } finally {
      clearCookie(response, this.auth.config!.secure, 'session');
    }
    return { ok: true };
  }
  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthBoundaryGuard)
  async logout(
    @Body() _body: EmptyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      await this.auth.logout(this.read(request, 'session'));
    } finally {
      clearCookie(response, this.auth.config!.secure, 'session');
    }
    return { ok: true };
  }
}
