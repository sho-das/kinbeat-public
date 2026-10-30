import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { MIN_REVEAL_LENGTH } from './masker';

@Injectable()
export class Hasher {
  private readonly key: string;

  constructor() {
    if (process.env.DATABASE_URL && !process.env.KINSO_HMAC_KEY) {
      throw new Error('KINSO_HMAC_KEY is required when DATABASE_URL is set. Without a fixed key, the same secret gets a new hash after every restart.');
    }
    this.key = process.env.KINSO_HMAC_KEY || randomBytes(32).toString('hex');
  }

  hash(value: string): string | null {
    if (value.length < MIN_REVEAL_LENGTH) return null;
    return createHmac('sha256', this.key).update(value).digest('hex');
  }
}
