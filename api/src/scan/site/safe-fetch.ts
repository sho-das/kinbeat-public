import { lookup as dnsLookup, LookupAddress } from 'dns';
import { request as httpRequest, IncomingHttpHeaders } from 'http';
import { request as httpsRequest } from 'https';
import { BlockList, isIP } from 'net';

// Fetches a public web address for the website scan. Visitors choose the address, so every address the server would
// connect to is checked first: private, local and reserved networks are refused, also after a redirect and after DNS,
// so the scan cannot be used to reach machines inside our own network.

const BLOCKED = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 96], ['::1', 128], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) BLOCKED.addSubnet(net, bits, 'ipv6');

export class SiteError extends Error {}

// An IPv6 address that carries an IPv4 one (::ffff:10.0.0.1) is checked as the IPv4 address.
export function blockedAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Used by the connection itself, so the address that is checked is the address that is used.
function safeLookup(hostname: string, options: { all?: boolean }, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    if (!addresses.length || addresses.some((a) => blockedAddress(a.address))) return callback(new SiteError('That address is not a public website.'), '');
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SiteError('Use a web address like https://example.com.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SiteError('Use a web address that starts with https:// or http://.');
  if (url.username || url.password) throw new SiteError('Use a web address without a name or password in it.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new SiteError('Use a normal web address, without a port number.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && blockedAddress(host)) throw new SiteError('That address is not a public website.');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new SiteError('That address is not a public website.');
  return url;
}

interface Fetched {
  url: URL;
  status: number;
  type: string;
  // null when the answer was larger than the limit.
  body: Buffer | null;
}

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

function once(url: URL, max: number, signal: AbortSignal): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method: 'GET', lookup: safeLookup as never, signal, timeout: TIMEOUT_MS, headers: { 'User-Agent': 'KinBeat secret scan (+https://kinbeat.com)', Accept: '*/*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (Number(res.headers['content-length']) > max) {
        res.destroy();
        return resolve({ status, headers: res.headers, body: null });
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > max) {
          res.destroy();
          resolve({ status, headers: res.headers, body: null });
        } else chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new SiteError('The website took too long to answer.')));
    req.on('error', reject);
    req.end();
  });
}

// Follows up to 4 redirects, checking each new address the same way.
export async function safeFetch(start: URL, max: number, signal: AbortSignal): Promise<Fetched> {
  let url = start;
  for (let hop = 0; ; hop++) {
    const { status, headers, body } = await once(url, max, signal);
    if (status >= 300 && status < 400 && headers.location) {
      if (hop >= MAX_REDIRECTS) throw new SiteError('The website sent too many redirects.');
      url = checkUrl(new URL(headers.location, url).toString());
      continue;
    }
    return { url, status, type: String(headers['content-type'] ?? ''), body };
  }
}
