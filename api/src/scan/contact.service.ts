import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MAIL_SENDER, MailSender } from '../auth/tokens';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ContactMessage {
  at: string;
  name: string;
  email: string;
  topic: string;
  message: string;
}

// Messages from the contact form on the home page. One line of JSON per message in a file, newest last,
// read back by the team's logs page. Each one is also mailed to CONTACT_ALERT_TO when that is set.
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);
  private readonly file = process.env.CONTACT_FILE || join(process.cwd(), 'data', 'contacts.jsonl');
  private readonly alertTo = (process.env.CONTACT_ALERT_TO ?? '').trim();

  constructor(@Optional() @Inject(MAIL_SENDER) private readonly mail?: MailSender) {}

  async save(entry: ContactMessage): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(entry) + '\n');
    this.logger.log(`contact message saved topic=${entry.topic}`);
    // The message is saved first; a mail problem never loses it or fails the visitor's send.
    if (this.alertTo && this.mail) {
      const from = entry.name ? `${entry.name} <${entry.email}>` : entry.email;
      const text = `From: ${from}\nSent: ${entry.at}\n\n${entry.message}\n\nReply by email. All messages: ${process.env.WEB_PUBLIC_URL ?? ''}/logs`;
      await this.mail.send({ to: this.alertTo, subject: `New KinBeat message from ${from}`, text }).catch((e: Error) => this.logger.warn(`contact alert mail failed: ${e.message}`));
    }
  }

  async list(limit = 200): Promise<ContactMessage[]> {
    const text = await readFile(this.file, 'utf8').catch(() => '');
    const rows = text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ContactMessage;
        } catch {
          return null;
        }
      })
      .filter((row): row is ContactMessage => row !== null);
    return rows.slice(-limit).reverse();
  }
}
