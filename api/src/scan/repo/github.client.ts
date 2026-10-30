import { BadGatewayException, BadRequestException, Inject, Injectable, NotFoundException, Optional, PayloadTooLargeException } from '@nestjs/common';
import { branchCandidates } from './repo-rules';

export const FETCH = Symbol('FETCH');
export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const STEP_TIMEOUT_MS = 30_000;
const SHA = /^[0-9a-f]{40}$/;
const NOT_FOUND = 'Repository not found, or it is not public.';
const HEADERS = { 'user-agent': 'KinBeat-repo-scan' };

// The only three GitHub addresses the server calls. Both are built here from a checked owner and repository, never from user text.
// No GitHub token is used: a public repository needs none, so a private one answers 404.
@Injectable()
export class GithubClient {
  private readonly send: typeof fetch;

  constructor(@Optional() @Inject(FETCH) send?: typeof fetch) {
    this.send = send ?? fetch;
  }

  // The newest commit of the default branch, or of the named branch. Nothing is downloaded.
  // owner and repo are set only when GitHub says the repository now has another name.
  async resolve(owner: string, repo: string, refPath: string | null, signal?: AbortSignal): Promise<{ sha: string; owner?: string; repo?: string } | null> {
    if (!refPath) return this.defaultBranch(owner, repo, signal);
    for (const ref of branchCandidates(refPath)) {
      const found = await this.branch(owner, repo, ref, signal);
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
  private async branch(owner: string, repo: string, ref: string, signal?: AbortSignal): Promise<{ sha: string } | null> {
    const response = await this.call(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, 'GET', signal, { accept: 'application/vnd.github.sha' });
    if (response.status === 404 || response.status === 422) return null;
    if (response.status === 403 || response.status === 429) throw new BadGatewayException('GitHub is busy with branch lookups right now. Try the plain repository link, or try again later.');
    const text = (await response.text()).trim();
    if (response.status !== 200 || !SHA.test(text)) throw new BadGatewayException('GitHub did not answer as expected. Try again in a moment.');
    return { sha: text };
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

  // The files of one exact commit, as a zip of at most 10 MB. The size is counted while it streams in.
  async download(owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<Buffer> {
    if (!SHA.test(sha)) throw new BadRequestException('Not a commit id.');
    const response = await this.call(`https://codeload.github.com/${owner}/${repo}/zip/${sha}`, 'GET', signal);
    if (response.status === 404) throw new NotFoundException(NOT_FOUND);
    if (response.status !== 200 || !response.body) throw new BadGatewayException('GitHub did not send the files. Try again in a moment.');
    const tooBig = () => new PayloadTooLargeException('This repository is larger than 10 MB to download, so it cannot be scanned here.');
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
      await response.body.cancel();
      throw tooBig();
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw tooBig();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  // Redirects are never followed by fetch. A redirect is read, checked, and refused unless it is one expected.
  private async call(url: string, method: 'GET' | 'HEAD', signal?: AbortSignal, extra: Record<string, string> = {}): Promise<Response> {
    const limit = AbortSignal.timeout(STEP_TIMEOUT_MS);
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
