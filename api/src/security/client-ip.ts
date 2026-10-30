// The visitor's address as Express sees it, behind the one trusted proxy (see TRUST_PROXY). Empty when unknown.
export const clientIp = (request: { ip?: string }): string => String(request.ip ?? '');

// The key every per-visitor limit uses. An unknown address shares one key, so no limit can be skipped by hiding it.
export const visitorKey = (request: { ip?: string }): string => clientIp(request) || 'unknown';
