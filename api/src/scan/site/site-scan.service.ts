import { BadRequestException, Injectable } from '@nestjs/common';
import { UploadedFile } from '../extract/types';
import { Progress } from '../progress';
import { ScanService } from '../scan.service';
import { checkUrl, safeFetch, SiteError } from './safe-fetch';

// One public web page and the script files it loads: the places a site's own keys most often end up.
// The free scan reads at most 10 of the site's scripts and keeps its first 50 findings, so its AI step stays at one batch.
// Scripts past 10 are not listed.
const SITE_MAX_SCRIPTS = 10;
const SITE_MAX_FINDINGS = 50;
const PAGE_MAX_BYTES = 5 * 1024 * 1024;
const SCRIPT_MAX_BYTES = 5 * 1024 * 1024;
const TOTAL_MAX_BYTES = 25 * 1024 * 1024;
const AT_ONCE = 5;

// Script addresses in the page: <script src> and <link rel="modulepreload" href>.
const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/gi;
const PRELOAD = /<link\b[^>]*?\brel\s*=\s*["']?modulepreload[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi;

// Scripts from well-known outside tools (analytics, ads, tag managers, chat widgets, consent banners) hold other companies'
// code, not the site's, and can be many, so they are skipped. Every other script is read, including the site's own
// script address on another domain, such as bbc.co.uk loading from bbci.co.uk.
const OUTSIDE_TOOLS = /(^|\.)(googletagmanager|google-analytics|googlesyndication|googleadservices|doubleclick|googleapis|gstatic|recaptcha|facebook|fbcdn|connect\.facebook|twitter|licdn|linkedin|hotjar|segment|segment\.io|mixpanel|amplitude|intercom|intercomcdn|zendesk|zdassets|hubspot|hs-scripts|hs-analytics|hsforms|drift|crisp|tawk|onetrust|cookielaw|cookiebot|consensu|optimizely|newrelic|nr-data|sentry-cdn|datadoghq|clarity|bing|yandex|tiktok|snapchat|pinterest|reddit|quantserve|scorecardresearch|chartbeat|parsely|taboola|outbrain|criteo|adnxs|amazon-adsystem|cloudflareinsights|stripe|paypal|youtube|vimeo|cdn\.jsdelivr|unpkg|cdnjs\.cloudflare|jquery)\.(com|net|io|org|co|ai|ms)$/i;
const ownScript = (script: string) => !OUTSIDE_TOOLS.test(new URL(script).hostname);

// A readable file name the scanner can sort by its ending: the page as .html, a script as .js.
function fileName(url: URL, ending: 'html' | 'js'): string {
  let path = url.pathname.replace(/\/+$/, '') || '/index';
  if (!path.toLowerCase().endsWith(`.${ending}`) && !(ending === 'js' && /\.m?js$/i.test(path))) path += `.${ending}`;
  return `${url.hostname}${path}`;
}

@Injectable()
export class SiteScanService {
  constructor(private readonly scans: ScanService) {}

  async scan(raw: string, useModel: boolean, owner: string, signal: AbortSignal, progress?: Progress) {
    try {
      // A bare name like example.com gets https:// in front; an address with another scheme is checked as it is, and refused.
      const start = checkUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
      progress?.('site', 0, 1);
      const page = await safeFetch(start, PAGE_MAX_BYTES, signal);
      if (page.status >= 400) throw new SiteError(`The website answered with an error (${page.status}).`);
      if (!page.body) throw new SiteError('The page is larger than 5 MB.');
      const html = page.body.toString('utf8');

      const found = new Set<string>();
      for (const pattern of [SCRIPT_SRC, PRELOAD]) for (const m of html.matchAll(pattern)) {
        try {
          const url = new URL(m[1].replace(/&amp;/g, '&'), page.url);
          if (url.protocol === 'https:' || url.protocol === 'http:') found.add(url.toString());
        } catch {
          // A broken address in the page is skipped.
        }
      }
      const scripts = [...found].filter(ownScript).slice(0, SITE_MAX_SCRIPTS);
      // A script that failed or was too big is listed as not scanned, by address without its ?query part.
      const where = (u: string | URL) => {
        const url = new URL(u);
        return `${url.hostname}${url.pathname}`;
      };
      const skipped: Array<{ file: string; type: string; notRead: true; note: string }> = [];

      const files: UploadedFile[] = [{ name: fileName(page.url, 'html'), buffer: page.body, fromArchive: true, label: fileName(page.url, 'html') }];
      let total = page.body.length;
      for (let i = 0; i < scripts.length; i += AT_ONCE) {
        signal.throwIfAborted();
        progress?.('site', i, scripts.length);
        const batch = await Promise.all(
          scripts.slice(i, i + AT_ONCE).map(async (u) => {
            try {
              const got = await safeFetch(checkUrl(u), SCRIPT_MAX_BYTES, signal);
              return { u, got: got.status < 400 ? got : null };
            } catch (error) {
              if (signal.aborted) throw error;
              return { u, got: null };
            }
          }),
        );
        for (const { u, got } of batch) {
          if (!got) skipped.push({ file: where(u), type: 'script', notRead: true, note: 'Could not be downloaded.' });
          else if (!got.body) skipped.push({ file: where(u), type: 'script', notRead: true, note: 'Larger than 5 MB.' });
          else if (total + got.body.length > TOTAL_MAX_BYTES) skipped.push({ file: where(u), type: 'script', notRead: true, note: 'Over the 25 MB limit for one website.' });
          if (!got?.body || total + got.body.length > TOTAL_MAX_BYTES) continue;
          total += got.body.length;
          const name = fileName(got.url, 'js');
          files.push({ name, buffer: got.body, fromArchive: true, label: name });
        }
      }
      progress?.('site', scripts.length, scripts.length);

      const result = await this.scans.scanFiles(files, useModel, owner, signal, { prepared: true, label: `Website: ${page.url.hostname}`, progress, maxFindings: SITE_MAX_FINDINGS });
      return { ...result, files: [...result.files, ...skipped], summary: { ...result.summary, unread: result.summary.unread + skipped.length } };
    } catch (error) {
      if (error instanceof SiteError) throw new BadRequestException(error.message);
      if (signal.aborted) throw error;
      // Network and certificate errors carry a code; each one means the site could not be found or reached.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new BadRequestException('That website could not be found.');
      if (typeof code === 'string') throw new BadRequestException('That website could not be reached.');
      throw error;
    }
  }
}
