import { BadGatewayException, BadRequestException, Inject, Injectable, NotFoundException, Optional, PayloadTooLargeException } from '@nestjs/common';
import { branchCandidates } from './repo-rules';

const FETCH = Symbol('FETCH');
// Pictures and videos fill most of a small website, so the download limit is higher than what is read from it.
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
// A private repository is the visitor's own, so it gets a higher limit.
export const MAX_PRIVATE_DOWNLOAD_BYTES = 100 * 1024 * 1024;
// One pull request's changes. A larger diff is left out of a history scan and counted as not scanned.
export const MAX_PULL_DIFF_BYTES = 1024 * 1024;
// A pull request with more than 300 changed files. Its diff is refused by GitHub, so its files are read page by page instead.
export const OVER_300_FILES = Symbol('over-300-files');
const STEP_TIMEOUT_MS = 30_000;
const SHA = /^[0-9a-f]{40}$/;
const NOT_FOUND = 'Repository not found, or it is not public.';
// One answer for a wrong token, a token without access and a missing repository, so a private repository cannot be told apart.
export const NO_ACCESS = "We could not open that repository with this token. Check the link and the token's access.";
export const TOKEN_BUSY = 'GitHub is busy. Try again in a minute.';
const HEADERS = { 'user-agent': 'KinBeat-repo-scan' };

// The only GitHub addresses the server calls, built here from a checked owner and repository, never from user text.
// A public repository needs no token. A visitor's token, when given, is used for one scan, only on api.github.com, and is never kept.
const bearer = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});
// GitHub answers a used-up allowance with 403 or 429, and says how much is left in a header.
const isLimited = (response: Response) => response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));

// Reads a download, counting its size as it streams in. Null when it is, or turns out to be, over max bytes.
async function readCapped(body: ReadableStream<Uint8Array>, headers: Headers, max: number): Promise<Buffer | null> {
  if (Number(headers.get('content-length')) > max) {
    await body.cancel();
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class GithubClient {
  private readonly send: typeof fetch;

  constructor(@Optional() @Inject(FETCH) send?: typeof fetch) {
    this.send = send ?? fetch;
  }

  // The newest commit of the default branch, or of the named branch. Nothing is downloaded.
  // owner and repo are set only when GitHub says the repository now has another name.
  async resolve(owner: string, repo: string, refPath: string | null, signal?: AbortSignal, token?: string): Promise<{ sha: string; owner?: string; repo?: string } | null> {
    // A token goes to the API, which also answers for private repositories. HEAD is the default branch.
    if (!refPath && !token) return this.defaultBranch(owner, repo, signal);
    for (const ref of refPath ? branchCandidates(refPath) : ['HEAD']) {
      const found = await this.branch(owner, repo, ref, signal, token);
      if (found) return found;
    }
    return null;
  }

  // GitHub answers this one with a redirect that carries the commit id, and it has no daily limit.
  // A renamed or moved repository first answers with a redirect to its new name on github.com. That one hop is followed,
  // and only to the same kind of address, so the answer can never send the scan to another site.
  private async defaultBranch(owner: string, repo: string, signal?: AbortSignal, renamed = false): Promise<{ sha: string; owner?: string; repo?: string } | null> {
    const response = await this.call(`https://github.com/${owner}/${repo}/archive/HEAD.zip`, 'HEAD', signal);
    if (response.status === 404) return null;
    if (response.status !== 301 && response.status !== 302) throw new BadGatewayException('GitHub did not answer as expected. Try again in a moment.');
    const location = response.headers.get('location') ?? '';
    const moved = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/archive\/HEAD\.zip$/.exec(location);
    if (moved && !renamed) {
      const found = await this.defaultBranch(moved[1], moved[2], signal, true);
      return found && { ...found, owner: moved[1], repo: moved[2] };
    }
    const match = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/zip\/([0-9a-f]{40})$/.exec(location);
    if (!match || match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase()) {
      throw new BadGatewayException('GitHub sent the files from an unexpected place, so the scan was stopped.');
    }
    return { sha: match[3] };
  }

  // A named branch has no such redirect, so the API is asked for the commit id only (a 40 character answer).
  // The API allows 60 such calls an hour from one address, and only /tree/ links use it.
  private async branch(owner: string, repo: string, ref: string, signal?: AbortSignal, token?: string): Promise<{ sha: string } | null> {
    const response = await this.call(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, 'GET', signal, { accept: 'application/vnd.github.sha', ...bearer(token) });
    if (response.status === 404 || response.status === 422) return null;
    if (token) {
      if (isLimited(response)) throw new BadGatewayException(TOKEN_BUSY);
      // A wrong token, a token without access, and a repository that moved all get the same answer as a missing one.
      if (response.status === 401 || response.status === 403 || response.status === 301) return null;
    }
    if (response.status === 403 || response.status === 429) throw new BadGatewayException('GitHub is busy with branch lookups right now. Try the plain repository link, or try again later.');
    const text = (await response.text()).trim();
    if (response.status !== 200 || !SHA.test(text)) throw new BadGatewayException('GitHub did not answer as expected. Try again in a moment.');
    return { sha: text };
  }

  // One call to api.github.com with the token. GitHub moves some repositories to their ID address, so one such redirect is followed,
  // and only when it stays on api.github.com with the same ID path. Any other answer is read as the token or access being wrong, or the repository missing.
  private async apiGet(url: string, accept: string, signal: AbortSignal | undefined, token: string): Promise<Response> {
    let response = await this.call(url, 'GET', signal, { accept, ...bearer(token) });
    if (response.status === 301) {
      const moved = /^https:\/\/api\.github\.com\/repositories\/\d+\//.exec(response.headers.get('location') ?? '');
      if (moved) response = await this.call(response.headers.get('location') as string, 'GET', signal, { accept, ...bearer(token) });
    }
    if (isLimited(response)) throw new BadGatewayException(TOKEN_BUSY);
    if ([301, 401, 403, 404, 422].includes(response.status)) throw new NotFoundException(NO_ACCESS);
    return response;
  }

  // The changed files of one pull request, 100 per page, for a pull request too big for one diff (over 300 files).
  // Each file's own patch is joined under a header, so the same line reader can read it. A file without a patch (too big for GitHub) is counted, not read.
  // Up to 3,000 files are read (up to 31 calls, the 31st only to check there are no more). Null when the joined text is over 1 MB.
  async pullFiles(owner: string, repo: string, number: number, signal: AbortSignal | undefined, token: string): Promise<{ patch: string; notRead: number } | null> {
    const parts: string[] = [];
    let notRead = 0;
    let total = 0;
    for (let page = 1; page <= 31; page++) {
      const response = await this.apiGet(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`, 'application/vnd.github+json', signal, token);
      if (response.status !== 200) throw new BadGatewayException('GitHub did not send the file list. Try again in a moment.');
      const files = (await response.json()) as Array<{ filename?: unknown; patch?: unknown }>;
      if (!Array.isArray(files) || files.length === 0) return { patch: parts.join(''), notRead };
      // A 31st page with files means the pull request has more than 3,000 files, so it is not read.
      if (page > 30) return null;
      for (const file of files) {
        if (typeof file.filename !== 'string' || typeof file.patch !== 'string') {
          notRead++;
          continue;
        }
        const part = `diff --git a/${file.filename} b/${file.filename}\n--- a/${file.filename}\n+++ b/${file.filename}\n${file.patch}\n`;
        total += part.length;
        if (total > MAX_PULL_DIFF_BYTES) return null;
        parts.push(part);
      }
      if (files.length < 100) return { patch: parts.join(''), notRead };
    }
    return null;
  }

  // The newest merged pull requests, first page first, with a token only. Closed but unmerged pull requests are skipped.
  // Each page is one call, so 100 pull requests cost one call. The list stops at the wanted count or at an empty page.
  async mergedPulls(owner: string, repo: string, wanted: number, signal: AbortSignal | undefined, token: string): Promise<number[]> {
    const numbers: number[] = [];
    for (let page = 1; numbers.length < wanted && page <= 50; page++) {
      const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`;
      const response = await this.apiGet(url, 'application/vnd.github+json', signal, token);
      if (response.status !== 200) throw new BadGatewayException('GitHub did not answer as expected. Try again in a moment.');
      const data = (await response.json()) as Array<{ number?: unknown; merged_at?: unknown }>;
      if (!Array.isArray(data) || data.length === 0) break;
      for (const pull of data) {
        if (typeof pull.number === 'number' && typeof pull.merged_at === 'string' && numbers.length < wanted) numbers.push(pull.number);
      }
    }
    return numbers;
  }

  // The added and removed lines of one pull request, as GitHub's patch text. Null when it is over 1 MB, so one huge pull request cannot fill the scan.
  async pullDiff(owner: string, repo: string, number: number, signal: AbortSignal | undefined, token: string): Promise<string | null | typeof OVER_300_FILES> {
    const response = await this.apiGet(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, 'application/vnd.github.diff', signal, token);
    if (response.status === 406) {
      // GitHub refuses a whole diff with more than 300 files and says so. The caller reads the files page by page instead.
      const text = await response.text();
      if (text.includes('maximum number of files')) return OVER_300_FILES;
      throw new BadGatewayException('GitHub did not send the changes. Try again in a moment.');
    }
    if (response.status !== 200 || !response.body) throw new BadGatewayException('GitHub did not send the changes. Try again in a moment.');
    const body = await readCapped(response.body, response.headers, MAX_PULL_DIFF_BYTES);
    return body ? body.toString('utf8') : null;
  }

  // When the commit was made and its web address. Only asked on a fresh scan, and a failure only means the date is left out.
  async commitInfo(owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<{ at: string | null; url: string }> {
    const url = `https://github.com/${owner}/${repo}/commit/${sha}`;
    try {
      const response = await this.call(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, 'GET', signal, { accept: 'application/vnd.github+json' });
      if (response.status !== 200) return { at: null, url };
      const data = (await response.json()) as { commit?: { committer?: { date?: unknown } } };
      const date = data.commit?.committer?.date;
      return { at: typeof date === 'string' && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null, url };
    } catch {
      signal?.throwIfAborted();
      return { at: null, url };
    }
  }

  // The files of one exact commit, as a zip of at most 50 MB (100 MB with a token). The size is counted while it streams in.
  async download(owner: string, repo: string, sha: string, signal?: AbortSignal, token?: string): Promise<Buffer> {
    if (!SHA.test(sha)) throw new BadRequestException('Not a commit id.');
    const url = token ? await this.privateZipUrl(owner, repo, sha, signal, token) : `https://codeload.github.com/${owner}/${repo}/zip/${sha}`;
    const response = await this.call(url, 'GET', signal);
    if (response.status === 404) throw new NotFoundException(token ? NO_ACCESS : NOT_FOUND);
    if (response.status !== 200 || !response.body) throw new BadGatewayException('GitHub did not send the files. Try again in a moment.');
    const max = token ? MAX_PRIVATE_DOWNLOAD_BYTES : MAX_DOWNLOAD_BYTES;
    const tooBig = () => new PayloadTooLargeException(`This repository is over ${max / (1024 * 1024)} MB to download, which is the most we can scan for now.`);
    const body = await readCapped(response.body, response.headers, max);
    if (!body) throw tooBig();
    return body;
  }

  // The API answers with a redirect to the download host, which carries its own short-lived link.
  // That link is read here, checked, and fetched without the token, so the token never leaves api.github.com.
  private async privateZipUrl(owner: string, repo: string, sha: string, signal: AbortSignal | undefined, token: string): Promise<string> {
    const hop = await this.call(`https://api.github.com/repos/${owner}/${repo}/zipball/${sha}`, 'GET', signal, { accept: 'application/vnd.github+json', ...bearer(token) });
    if (isLimited(hop)) throw new BadGatewayException(TOKEN_BUSY);
    if ([301, 401, 403, 404, 422].includes(hop.status)) throw new NotFoundException(NO_ACCESS);
    const match = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/legacy\.zip\/([0-9a-f]{40})(\?token=[A-Za-z0-9_.-]+)?$/.exec(hop.headers.get('location') ?? '');
    if (hop.status !== 302 || !match || match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase() || match[3] !== sha) {
      throw new BadGatewayException('GitHub sent the files from an unexpected place, so the scan was stopped.');
    }
    return match[0];
  }

  // Redirects are never followed by fetch. A redirect is read, checked, and refused unless it is one expected.
  private async call(url: string, method: 'GET' | 'HEAD', signal?: AbortSignal, extra: Record<string, string> = {}): Promise<Response> {
    const limit = AbortSignal.timeout(STEP_TIMEOUT_MS);
    // A token header is allowed on one host only. A mistake elsewhere in this file can then never send it to another site.
    if ('authorization' in extra && new URL(url).host !== 'api.github.com') throw new Error('The token may only be sent to api.github.com.');
    try {
      const response = await this.send(url, { method, redirect: 'manual', headers: { ...HEADERS, ...extra }, signal: signal ? AbortSignal.any([signal, limit]) : limit });
      signal?.throwIfAborted();
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      if ((error as Error).name === 'TimeoutError') throw new BadGatewayException('GitHub took too long to answer. Try again in a moment.');
      throw new BadGatewayException('GitHub could not be reached. Try again in a moment.');
    }
  }
}
