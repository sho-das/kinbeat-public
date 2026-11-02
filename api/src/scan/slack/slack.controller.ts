import type { Response } from 'express';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, NotFoundException, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public';
import { parseCookies, secureCookies } from '../../auth/cookie';
import { visitorKey } from '../../security/client-ip';
import { ScanRateLimitGuard } from '../../security/rate-limit';
import { PrHistoryJobs } from '../repo/pr-history.job';
import { SLACK_USER_SCOPES, SlackClient } from './slack.client';
import { SlackService } from './slack.service';
import { SlackSessions } from './slack.sessions';

type Request = { ip?: string; headers: Record<string, string | string[] | undefined> };

const cookieName = () => (secureCookies() ? '__Host-kb_slack' : 'kb_slack');
// The sign-in's one-time value, kept in this browser too, so a sign-in link from someone else is refused.
const stateCookie = () => (secureCookies() ? '__Host-kb_slack_state' : 'kb_slack_state');
const cookieBase = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: secureCookies(), path: '/' });
// Must match a Redirect URL saved in the Slack app's settings exactly. Slack accepts only https addresses.
const redirectUri = () => process.env.SLACK_REDIRECT_URL || 'https://localhost:3001/api/slack/callback';
const CHAT_ID = /^[CDG][A-Z0-9]{6,20}$/;

// Connect Slack: the visitor gives read-only access on Slack's own page, and the token stays in memory for 10 minutes.
// The scan itself runs as a background job, read with the same endpoints as the pull request history scan.
@Public()
@Controller('slack')
export class SlackController {
  constructor(
    private readonly client: SlackClient,
    private readonly sessions: SlackSessions,
    private readonly slack: SlackService,
    private readonly jobs: PrHistoryJobs,
  ) {}

  @Get('start')
  @UseGuards(ScanRateLimitGuard)
  start(@Res() res: Response) {
    if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) throw new NotFoundException('Slack is not set up on this server.');
    const state = this.sessions.newState();
    if (!state) throw new HttpException('Too many Slack sign-ins right now. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', process.env.SLACK_CLIENT_ID);
    url.searchParams.set('user_scope', SLACK_USER_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('state', state);
    res.cookie(stateCookie(), state, { ...cookieBase(), maxAge: 10 * 60 * 1000 });
    res.redirect(url.toString());
  }

  // Slack sends the visitor back here. A refusal, or an admin approval still pending, comes back without a code.
  @Get('callback')
  async callback(@Query() query: { code?: string; state?: string; error?: string }, @Req() req: Request, @Res() res: Response) {
    // A path, not a full address, so the visitor lands back on the same site they came from.
    const back = (status: string) => res.redirect(`/?slack=${status}#scan`);
    const mine = parseCookies(req.headers.cookie as string | undefined)[stateCookie()];
    res.clearCookie(stateCookie(), { path: '/' });
    if (!query.state || query.state !== mine || !this.sessions.useState(query.state)) return back('failed');
    if (query.error || !query.code) return back(query.error === 'access_denied' ? 'denied' : 'failed');
    try {
      const session = await this.client.exchange(query.code, redirectUri());
      // No end date on the cookie: the server ends the connection, and a running scan keeps it open.
      res.cookie(cookieName(), this.sessions.open(session), cookieBase());
      return back('connected');
    } catch {
      return back('failed');
    }
  }

  @Get('chats')
  async chats(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const { session } = this.session(req);
    return { team: session.team, chats: await this.slack.chats(session.token) };
  }

  @Delete('session')
  @HttpCode(200)
  disconnect(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.sessions.close(parseCookies(req.headers.cookie as string | undefined)[cookieName()]);
    res.clearCookie(cookieName(), { path: '/' });
    return { disconnected: true };
  }

  @Post('scan')
  @UseGuards(ScanRateLimitGuard)
  @HttpCode(202)
  scan(@Body() body: { chat?: unknown; cursor?: unknown; useModel?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { chat, cursor, useModel } = body ?? {};
    if (typeof chat !== 'string' || !CHAT_ID.test(chat)) throw new BadRequestException('Pick a Slack chat first.');
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 500)) throw new BadRequestException('cursor must be text');
    if (useModel !== undefined && typeof useModel !== 'boolean') throw new BadRequestException('useModel must be true or false');
    const { id, session } = this.session(req);
    res.setHeader('Cache-Control', 'no-store');
    const job = this.jobs.start(visitorKey(req), session.token, (progress, signal) =>
      this.sessions.hold(id, () => this.slack.scan(session.token, chat, cursor || undefined, useModel ?? true, AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]), progress)),
    );
    return { id: job.id, state: job.state, done: job.done, total: job.total };
  }

  private session(req: Request) {
    const id = parseCookies(req.headers.cookie as string | undefined)[cookieName()];
    const session = this.sessions.get(id);
    if (!session) throw new UnauthorizedException('Your Slack connection has ended. Connect Slack again.');
    return { id, session };
  }
}
