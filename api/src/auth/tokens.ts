export const MAIL_SENDER = Symbol('MAIL_SENDER');
export const CLOCK = Symbol('CLOCK');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

export interface Clock {
  now(): number;
}
