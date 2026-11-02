import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { positiveEnv } from '../limits';
import { SlackClient } from './slack.client';

// A visitor's Slack connection, in memory only. It ends 10 minutes after its last use, on Disconnect, or when the API stops.
// When it ends, the token is also cancelled at Slack, so it stops working everywhere.
// SLACK_SESSION_MINUTES changes it, for example 1 to see the ended-connection message quickly.
export const SLACK_SESSION_MS = positiveEnv('SLACK_SESSION_MINUTES', 10) * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;
// Sign-ins started but not finished. Past this many, new ones wait until old ones expire.
const MAX_STATES = 1000;

interface Session {
  token: string;
  userId: string;
  team: string;
  at: number;
  // Scans running with this connection. A connection is never ended while one runs.
  busy: number;
}

@Injectable()
export class SlackSessions implements OnApplicationShutdown {
  private readonly sessions = new Map<string, Session>();
  // One-time values sent to Slack's permission page and checked on the way back, so a forged return is refused.
  private readonly states = new Map<string, number>();

  constructor(private readonly slack: SlackClient) {
    // Ends connections on time even when no one visits, so a token is never left waiting in memory.
    setInterval(() => this.sweep(), 60_000).unref();
  }

  newState(): string | null {
    this.sweep();
    if (this.states.size >= MAX_STATES) return null;
    const state = randomBytes(24).toString('hex');
    this.states.set(state, Date.now());
    return state;
  }

  useState(state: string): boolean {
    const at = this.states.get(state);
    this.states.delete(state);
    return at !== undefined && Date.now() - at < STATE_MS;
  }

  open(session: Omit<Session, 'at' | 'busy'>): string {
    this.sweep();
    const id = randomBytes(24).toString('hex');
    this.sessions.set(id, { ...session, at: Date.now(), busy: 0 });
    return id;
  }

  get(id: string | undefined): Session | undefined {
    this.sweep();
    return id ? this.sessions.get(id) : undefined;
  }

  // Keeps a connection open while a scan runs. The 10 minutes start again when the scan ends.
  async hold<T>(id: string, work: () => Promise<T>): Promise<T> {
    const session = this.sessions.get(id);
    if (session) session.busy++;
    try {
      return await work();
    } finally {
      if (session) {
        session.busy--;
        session.at = Date.now();
      }
    }
  }

  close(id: string | undefined): void {
    const session = id ? this.sessions.get(id) : undefined;
    if (!session) return;
    this.sessions.delete(id!);
    this.slack.revoke(session.token);
  }

  // Tokens live only in memory, so they are cancelled at Slack before the API stops, not left valid.
  async onApplicationShutdown(): Promise<void> {
    const tokens = [...this.sessions.values()].map((s) => s.token);
    this.sessions.clear();
    await Promise.race([Promise.allSettled(tokens.map((t) => this.slack.revoke(t))), new Promise((r) => setTimeout(r, 3000))]);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (s.busy === 0 && now - s.at > SLACK_SESSION_MS) this.close(id);
    for (const [state, at] of this.states) if (now - at > STATE_MS) this.states.delete(state);
  }
}
