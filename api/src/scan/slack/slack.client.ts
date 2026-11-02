import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

// Read-only access a visitor gives KinBeat: list their chats and read the messages in them.
// The same list is in slack-manifest.yaml at the repository root; keep the two the same.
export const SLACK_USER_SCOPES = ['channels:read', 'groups:read', 'im:read', 'mpim:read', 'channels:history', 'groups:history', 'im:history', 'mpim:history', 'users:read'];

// Slack answers with ok: false and a short code. Only codes we know become a sentence; the rest get a fixed one.
const SLACK_ERRORS: Record<string, string> = {
  not_in_channel: 'You are not a member of this chat in Slack.',
  channel_not_found: 'Slack could not find this chat. It may be archived or deleted.',
  invalid_auth: 'The Slack connection has ended. Connect Slack again.',
  token_revoked: 'The Slack connection has ended. Connect Slack again.',
  token_expired: 'The Slack connection has ended. Connect Slack again.',
  missing_scope: 'KinBeat does not have permission to read this kind of chat.',
};

@Injectable()
export class SlackClient {
  // One Web API call. A 429 waits as long as Slack asks, up to 30 seconds a time.
  async call<T = any>(method: string, token: string, params: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<T> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') body.set(key, String(value));
    for (;;) {
      signal?.throwIfAborted();
      const res = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal });
      if (res.status === 429) {
        const wait = Math.min(Number(res.headers.get('retry-after') ?? 5), 30) * 1000;
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new HttpException(SLACK_ERRORS[data.error ?? ''] ?? 'Slack refused the request. Try again.', data.error && /auth|revoked|expired/.test(data.error) ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_GATEWAY);
      return data as T;
    }
  }

  // Cancels a visitor's token at Slack. A failure is ignored: the token is already forgotten here either way.
  revoke(token: string): Promise<void> {
    return fetch('https://slack.com/api/auth.revoke', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).then(
      () => undefined,
      () => undefined,
    );
  }

  // Swaps the one-time code from Slack's permission page for the visitor's own read-only token.
  async exchange(code: string, redirectUri: string): Promise<{ token: string; userId: string; team: string }> {
    const body = new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID ?? '', client_secret: process.env.SLACK_CLIENT_SECRET ?? '', code, redirect_uri: redirectUri });
    const res = await fetch('https://slack.com/api/oauth.v2.access', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = (await res.json()) as { ok: boolean; authed_user?: { id: string; access_token?: string }; team?: { name: string } };
    if (!data.ok || !data.authed_user?.access_token) throw new HttpException('Slack did not connect. Try again.', HttpStatus.BAD_GATEWAY);
    return { token: data.authed_user.access_token, userId: data.authed_user.id, team: data.team?.name ?? 'Slack' };
  }
}
