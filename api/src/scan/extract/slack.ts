interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  username?: string;
  user_name?: string;
  user_profile?: { real_name?: string; display_name?: string };
}

const isMessage = (item: unknown): item is SlackMessage =>
  typeof item === 'object' && item !== null && typeof (item as SlackMessage).ts === 'string' && /^\d+(\.\d+)?$/.test((item as SlackMessage).ts) && typeof (item as SlackMessage).text === 'string';

// A person's name as the chat line reader expects it: no spaces, so "ben - Infra" becomes "ben_-_Infra".
// Messages are joined into one split key only when the name before them matches.
export function nameToken(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function authorOf(message: SlackMessage): string {
  return nameToken(message.user_profile?.display_name || message.user_profile?.real_name || message.user_name || message.username || message.user || 'unknown');
}

export function readSlackMessages(raw: string): { text: string; messages: number } | null {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const messages = parsed.filter(isMessage);
  if (messages.length === 0 || messages.length < parsed.length / 2) return null;
  const lines = messages
    .filter((m) => m.text.trim())
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .map((m) => {
      const stamp = new Date(Number(m.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      return `[${stamp}] ${authorOf(m)}: ${m.text.replace(/\s*[\r\n]+\s*/g, ' ').trim()}`;
    });
  if (lines.length === 0) return null;
  return { text: lines.join('\n'), messages: lines.length };
}
