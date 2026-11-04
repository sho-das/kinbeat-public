import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { Public } from '../auth/public';
import { visitorKey } from '../security/client-ip';
import { RateLimiter } from '../security/rate-limit';
import { ContactMessage, ContactService } from './contact.service';

const TOPICS = ['not-working', 'scan-github', 'other'];
const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.normalize('NFKC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');

@Controller('contact')
export class ContactController {
  // One message a minute per visitor, and 20 an hour across everyone.
  private readonly perVisitor = new RateLimiter(1, 60_000);
  private readonly total = new RateLimiter(20, 3_600_000);

  constructor(private readonly contact: ContactService) {}

  @Public()
  @Post()
  @HttpCode(200)
  async send(@Body() body: Partial<ContactMessage>, @Req() req: { ip?: string }) {
    const entry: ContactMessage = {
      at: new Date().toISOString(),
      name: clean(body?.name, 120),
      email: clean(body?.email, 200),
      topic: TOPICS.includes(String(body?.topic)) ? String(body?.topic) : 'other',
      message: clean(body?.message, 2000),
    };
    if (!entry.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email)) throw new BadRequestException('Add an email address we can reply to.');
    if (!entry.message) throw new BadRequestException('Write a message.');
    if (!this.perVisitor.hit(visitorKey(req)).allowed || !this.total.hit('all').allowed) throw new HttpException('Please wait a moment before sending again.', HttpStatus.TOO_MANY_REQUESTS);
    await this.contact.save(entry);
    return { ok: true };
  }

  // The team's logs page. Every route here is behind the admin sign-in unless marked public.
  @Get()
  list() {
    return this.contact.list();
  }
}
