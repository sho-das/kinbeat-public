import { Injectable, NotFoundException } from '@nestjs/common';
import { nameToken } from '../extract/slack';
import { UploadedFile } from '../extract/types';
import { ScanService } from '../scan.service';
import { SlackClient } from './slack.client';

// One scan reads exactly this many chat messages (thread replies come along and are not counted), newest first.
// The page then asks for the next ones from where it stopped: 1 to 10,000, then 10,001 to 20,000, and so on.
const SLACK_SCAN_MESSAGES = 10_000;
// Messages per piece of text the scanner reads. Pieces overlap a little, so a key split over two messages is still found.
const PIECE = 500;
const OVERLAP = 5;
const PAGE = 200;

export interface SlackChat {
  id: string;
  name: string;
  kind: 'public' | 'private' | 'dm' | 'group';
}

interface Message {
  ts: string;
  user?: string;
  username?: string;
  text?: string;
  subtype?: string;
  reply_count?: number;
  thread_ts?: string;
}

type Page = { response_metadata?: { next_cursor?: string } } & Record<string, unknown>;

// The time of a Slack message, as "2 Nov 20:41", from its ts value (seconds since 1970).
const timeOf = (ts: string) => new Date(Number(ts) * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

// Slack sends text with &amp; &lt; &gt; and links as <url|label>. They are turned back into what the person typed,
// so a key with an & in it keeps its shape. A mention <@U123> becomes the person's name.
function plainText(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (_, id: string) => `@${names.get(id) ?? id}`)
    .replace(/<([^<>|]+)\|([^<>]+)>/g, (_, url: string, label: string) => (label === url ? url : `${label} ${url}`))
    .replace(/<([^<>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function chatOf(c: any, names: Map<string, string>): SlackChat {
  if (c.is_im) return { id: c.id, name: names.get(c.user) ?? 'Direct message', kind: 'dm' };
  if (c.is_mpim) return { id: c.id, name: (c.name as string).replace(/^mpdm-|-1$/g, '').split('--').join(', '), kind: 'group' };
  return { id: c.id, name: `#${c.name}`, kind: c.is_private ? 'private' : 'public' };
}

@Injectable()
export class SlackService {
  constructor(
    private readonly slack: SlackClient,
    private readonly scans: ScanService,
  ) {}

  // Every chat the visitor can read: all public channels, and the private channels, group and direct messages they are in.
  async chats(token: string): Promise<SlackChat[]> {
    const names = await this.people(token);
    const chats = (await this.all<any>('conversations.list', 'channels', token, { types: 'public_channel,private_channel,mpim,im', exclude_archived: true })).map((c) => chatOf(c, names));
    const order = { public: 0, private: 1, group: 2, dm: 3 };
    return chats.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  }

  // Reads SLACK_SCAN_MESSAGES messages of one chat, newest first, with their thread replies, and scans them.
  // The answer includes where to carry on, so the page can offer the next messages.
  async scan(token: string, chatId: string, cursor: string | undefined, useModel: boolean, signal: AbortSignal, progress: (done: number, total: number) => void) {
    if (useModel) this.scans.wakeModel();
    const names = await this.people(token, signal);
    const info = await this.slack.call<{ channel: unknown }>('conversations.info', token, { channel: chatId }, signal).catch(() => null);
    if (!info) throw new NotFoundException('Slack could not find this chat, or you cannot read it.');
    const chat = chatOf(info.channel, names);

    // Each top-level message with its thread replies right after it, so every thread reads in the order it was written.
    const threads: Message[][] = [];
    let read = 0;
    let top = 0;
    let next = cursor ?? '';
    progress(0, SLACK_SCAN_MESSAGES);
    do {
      const limit = Math.min(PAGE, SLACK_SCAN_MESSAGES - top);
      const page = await this.slack.call<{ messages: Message[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>('conversations.history', token, { channel: chat.id, limit, cursor: next }, signal);
      top += page.messages.length;
      for (const m of page.messages) {
        const thread = [m];
        if (m.reply_count && m.thread_ts) thread.push(...(await this.all<Message>('conversations.replies', 'messages', token, { channel: chat.id, ts: m.thread_ts }, signal)).filter((r) => r.ts !== m.ts));
        threads.push(thread);
        read += thread.length;
      }
      next = page.has_more ? (page.response_metadata?.next_cursor ?? '') : '';
      progress(top, SLACK_SCAN_MESSAGES);
    } while (next && top < SLACK_SCAN_MESSAGES);
    progress(read, read);

    // History comes newest first; the threads are put oldest first, so a key split over two messages reads in order.
    const ordered = threads
      .reverse()
      .flat()
      .filter((m) => m.text && !/^(channel_join|channel_leave|channel_topic|channel_purpose)$/.test(m.subtype ?? ''));
    const author = (m: Message) => m.username ?? names.get(m.user ?? '') ?? 'Someone';
    const pieces: Array<{ file: UploadedFile; lines: Message[] }> = [];
    for (let start = 0; start < ordered.length; start += PIECE) {
      const from = Math.max(0, start - OVERLAP);
      const part = ordered.slice(from, start + PIECE);
      const lines: Message[] = [];
      const text: string[] = [];
      for (const m of part) {
        // [hh:mm] name: text is the chat line shape the scanner reads, also for keys split over messages of one person.
        const hhmm = new Date(Number(m.ts) * 1000).toISOString().slice(11, 16);
        for (const [i, row] of plainText(m.text!, names).split('\n').entries()) {
          text.push(i === 0 ? `[${hhmm}] ${nameToken(author(m))}: ${row}` : row);
          lines.push(m);
        }
      }
      const name = `${chat.name} messages ${from + 1}-${from + part.length}`;
      pieces.push({ lines, file: { name: `${name}.txt`, buffer: Buffer.from(text.join('\n'), 'utf8'), fromArchive: true, label: name } });
    }

    const result = (await this.scans.scanFiles(
      pieces.map((p) => p.file),
      useModel,
      undefined,
      signal,
      { prepared: true, label: `Slack: ${chat.kind === 'dm' ? 'direct message' : chat.name}`, progress: (step) => step === 'ai' && progress(Math.floor(read * 0.95), read) },
    )) as { findings: Array<{ hash: string; place: { file?: string; line?: number } }>; [key: string]: unknown };

    // Each finding names the chat, the person and the time instead of a piece and line. The overlap can find one key twice.
    const seen = new Set<string>();
    const findings = result.findings.flatMap((f) => {
      const piece = pieces.find((p) => p.file.label === f.place.file);
      const m = piece?.lines[(f.place.line ?? 1) - 1];
      const key = `${f.hash}:${m?.ts}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...f, place: { file: m ? `${chat.name}, ${author(m)}, ${timeOf(m.ts)}` : chat.name } }];
    });
    // read: chat messages this scan covered, so the page can say 1 to 10,000, then 10,001 to 20,000.
    return { ...result, findings, slack: { messages: ordered.length, read: top, next: next || undefined } };
  }

  // Every item of a Slack list, page by page.
  private async all<T>(method: string, field: string, token: string, params: Record<string, string | number | boolean>, signal?: AbortSignal): Promise<T[]> {
    const out: T[] = [];
    let cursor = '';
    do {
      const page = await this.slack.call<Page>(method, token, { ...params, limit: PAGE, cursor }, signal);
      out.push(...((page[field] as T[]) ?? []));
      cursor = page.response_metadata?.next_cursor ?? '';
    } while (cursor);
    return out;
  }

  // Display names by Slack user id, so findings show a name, not an id.
  private async people(token: string, signal?: AbortSignal): Promise<Map<string, string>> {
    const members = await this.all<any>('users.list', 'members', token, {}, signal);
    return new Map(members.map((u) => [u.id, u.profile?.display_name || u.real_name || u.name]));
  }
}
