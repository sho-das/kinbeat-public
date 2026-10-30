export function secureCookies(): boolean {
  return process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
}

export const sessionCookie = () => (secureCookies() ? '__Host-kb_session' : 'kb_session');
export const loginCookie = () => (secureCookies() ? '__Host-kb_login' : 'kb_login');

// A cookie value with a broken % sequence is kept as it is, instead of making the whole request fail.
export function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (name && !(name in out)) out[name] = decodeCookieValue(part.slice(at + 1).trim());
  }
  return out;
}
