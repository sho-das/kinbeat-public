import { Logger } from '@nestjs/common';
import { MailMessage, MailSender } from './tokens';

const DEFAULT_ENDPOINT = 'https://api.zeptomail.eu/v1.1/email';
const KEY_PREFIX = 'Zoho-enczapikey ';
const TIMEOUT_MS = 10_000;

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

// Brevo when its key is set, else ZeptoMail when its token is set, else the log (development only).
export function mailMode(): 'brevo' | 'zeptomail' | 'log' {
  if (process.env.BREVO_API_KEY?.trim()) return 'brevo';
  if (process.env.ZEPTOMAIL_TOKEN?.trim()) return 'zeptomail';
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Login mail needs BREVO_API_KEY or ZEPTOMAIL_TOKEN in production, so the API will not start without it.');
  }
  return 'log';
}

export function makeMailSender(): MailSender {
  const mode = mailMode();
  return mode === 'brevo' ? new BrevoMailSender() : mode === 'zeptomail' ? new ZeptoMailSender() : new LogMailSender();
}

// Brevo's send API: the key goes in an api-key header; the message is plain text, no tracking.
export class BrevoMailSender implements MailSender {
  private readonly key = (process.env.BREVO_API_KEY ?? '').trim();
  private readonly fromAddress = process.env.MAIL_FROM_ADDRESS || 'noreply@kinbeat.com';
  private readonly fromName = process.env.MAIL_FROM_NAME || 'KinBeat';

  async send(message: MailMessage): Promise<void> {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': this.key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: this.fromAddress, name: this.fromName },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Brevo HTTP ${response.status}`);
  }
}

export class LogMailSender implements MailSender {
  private readonly logger = new Logger('LoginMail');

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(`Login link for ${message.to} (development only, nothing was emailed):\n${message.text}`);
  }
}

export class ZeptoMailSender implements MailSender {
  private readonly auth: string;
  private readonly endpoint: string;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor() {
    const token = (process.env.ZEPTOMAIL_TOKEN ?? '').trim();
    this.auth = token.startsWith(KEY_PREFIX) ? token : `${KEY_PREFIX}${token}`;
    this.endpoint = process.env.ZEPTOMAIL_ENDPOINT || DEFAULT_ENDPOINT;
    this.fromAddress = process.env.MAIL_FROM_ADDRESS || 'noreply@kinbeat.com';
    this.fromName = process.env.MAIL_FROM_NAME || 'KinBeat';
  }

  async send(message: MailMessage): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: this.auth, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        from: { address: this.fromAddress, name: this.fromName },
        to: [{ email_address: { address: message.to } }],
        subject: message.subject,
        textbody: message.text,
        track_opens: false,
        track_clicks: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ZeptoMail HTTP ${response.status}`);
  }
}
