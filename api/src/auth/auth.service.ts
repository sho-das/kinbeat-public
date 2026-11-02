import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { positiveEnv } from '../scan/limits';
import { AdminRecord, AUTH_STORE, AuthStore, normaliseEmail } from '../store/types';
import { AuditService } from './audit.service';
import { parseCookies, secureCookies, sessionCookie } from './cookie';
import { CLOCK, Clock, MAIL_SENDER, MailSender } from './tokens';

const LINK_MINUTES = 10;
const SESSION_HOURS = 12;
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const limit = () => positiveEnv('LOGIN_RATE_LIMIT', 5);

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  // With a database, admins live in the admins table only (add one with the SQL in the README).
  // ADMIN_EMAILS seeds admins only when there is no database, for tests and quick local runs.
  async onModuleInit(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      const emails = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean);
      for (const email of emails) await this.store.addAdmin(email);
    }
    const count = await this.store.countAdmins();
    if (count) this.logger.log(`admins ready: ${count}`);
    else this.logger.warn('There are no admins. Add one with the SQL in the README, or set ADMIN_EMAILS when running without a database.');
  }

  publicUrl(): string {
    return (process.env.WEB_PUBLIC_URL || 'https://localhost:3001').replace(/\/+$/, '');
  }

  async requestLogin(rawEmail: unknown, ip: string): Promise<{ bind: string }> {
    if (typeof rawEmail !== 'string' || rawEmail.length > 254 || !EMAIL_SHAPE.test(rawEmail.trim())) {
      throw new BadRequestException('Send a valid email address.');
    }
    const email = normaliseEmail(rawEmail);
    const now = this.clock.now();
    const window = LINK_MINUTES * 60_000;
    const first = await this.store.hitLimit(`ip:${ip}`, limit(), window, now);
    const second = await this.store.hitLimit(`email:${email}`, limit(), window, now);
    if (!first.allowed || !second.allowed) {
      throw new HttpException('Too many sign-in requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const bind = random();
    const admin = await this.store.findAdminByEmail(email);
    if (admin) {
      await this.audit.record('login_requested', admin, {}, ip);
      const token = random();
      await this.store.createLoginToken({ hash: sha(token), adminId: admin.id, bindHash: sha(bind), expiresAt: this.clock.now() + LINK_MINUTES * 60_000, ip });
      void this.mail
        .send({
          to: admin.email,
          subject: 'Your KinBeat sign-in link',
          text: `Open this link in the same browser to sign in. It works once and expires in ${LINK_MINUTES} minutes.\n${this.publicUrl()}/login/verify#t=${token}\nIf you did not ask for it, ignore this email.`,
        })
        .catch((error) => this.logger.warn(`login mail failed: ${(error as Error).name}`));
    }
    return { bind };
  }

  async verify(rawToken: unknown, bind: string | undefined, ip: string, userAgent: string): Promise<{ session: string; admin: AdminRecord }> {
    const invalid = new UnauthorizedException('This link is not valid any more. Ask for a new one.');
    if (typeof rawToken !== 'string' || !rawToken || rawToken.length > 200 || !bind) {
      await this.audit.record('login_failed', undefined, { reason: 'missing_or_malformed' }, ip);
      throw invalid;
    }
    const now = this.clock.now();
    const admin = await this.store.consumeLoginToken(sha(rawToken), sha(bind), now);
    if (!admin) {
      await this.audit.record('login_failed', undefined, { reason: 'invalid_or_expired_link' }, ip);
      throw invalid;
    }
    const session = random();
    await this.store.createSession({ hash: sha(session), adminId: admin.id, expiresAt: now + SESSION_HOURS * 3_600_000, ip, userAgent });
    await this.audit.record('login_ok', admin, {}, ip);
    return { session, admin };
  }

  async adminFromCookies(header: string | undefined): Promise<AdminRecord | undefined> {
    const value = parseCookies(header)[sessionCookie()];
    return value ? this.store.findSession(sha(value), this.clock.now()) : undefined;
  }

  async logout(header: string | undefined, admin?: AdminRecord, ip?: string): Promise<void> {
    const value = parseCookies(header)[sessionCookie()];
    if (value) await this.store.deleteSession(sha(value));
    if (admin) await this.audit.record('logout', admin, {}, ip);
  }

  checkOrigin(origin: string | undefined): void {
    if (!origin) return;
    const allowed = new Set([new URL(this.publicUrl()).origin]);
    if (!secureCookies()) {
      const url = new URL(this.publicUrl());
      for (const host of ['localhost', '127.0.0.1']) allowed.add(`${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`);
    }
    if (!allowed.has(origin)) throw new ForbiddenException('That request came from another site.');
  }
}
