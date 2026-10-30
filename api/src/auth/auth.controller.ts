import type { Response } from 'express';
import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { clientIp } from '../security/client-ip';
import { AuthService } from './auth.service';
import { decodeCookieValue, loginCookie, secureCookies, sessionCookie } from './cookie';
import { Public } from './public';

const baseCookie = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: secureCookies(), path: '/' });

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request')
  @HttpCode(202)
  async request(@Body() body: { email?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: Response) {
    const { bind } = await this.auth.requestLogin(body?.email, clientIp(req));
    res.cookie(loginCookie(), bind, { ...baseCookie(), maxAge: 10 * 60_000 });
    return { ok: true, message: 'If that email belongs to an admin, a sign-in link was sent.' };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: { token?: unknown }, @Req() req: { ip?: string; headers: Record<string, string | string[] | undefined> }, @Res({ passthrough: true }) res: Response) {
    const cookies = req.headers.cookie as string | undefined;
    const bind = cookies?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${loginCookie()}=`))?.slice(loginCookie().length + 1);
    const { session, admin } = await this.auth.verify(body?.token, bind ? decodeCookieValue(bind) : undefined, clientIp(req), String(req.headers['user-agent'] ?? ''));
    res.cookie(sessionCookie(), session, { ...baseCookie(), maxAge: 12 * 3_600_000 });
    res.clearCookie(loginCookie(), baseCookie());
    return { admin: { email: admin.email } };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.auth.logout(req.headers.cookie, req.admin, clientIp(req));
    res.clearCookie(sessionCookie(), baseCookie());
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: any) {
    return { admin: req.admin ? { email: req.admin.email } : null };
  }
}
