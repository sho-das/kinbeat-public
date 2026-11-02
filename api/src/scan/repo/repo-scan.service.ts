import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { MuseClient } from '../muse.client';
import { ScanService } from '../scan.service';
import { maskName } from '../scrubber';
import { UploadedFile } from '../extract/types';
import { isSafePath, readZip, zipNames } from '../extract/zip';
import { GithubClient, MAX_DOWNLOAD_BYTES, MAX_PRIVATE_DOWNLOAD_BYTES, NO_ACCESS } from './github.client';
import { insideRepo, isPicture, parseRepoLink, skipReason } from './repo-rules';
import { RepoCache } from './repo.cache';
import { Progress } from '../progress';

const REPO_FILE_LIMIT = 200;
// Each picture is one call to the model, so a repository full of pictures is read only up to this many.
const REPO_PICTURE_LIMIT = 10;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// 2: reasons are fixed sentences, so results saved with the AI's own sentences are not served again.
const SCANNER_VERSION = '3';
const NOT_FOUND = 'Repository not found, or it is not public.';
const REPO_NOTE = 'Current files only. Old commits and deleted files were not checked.';
const MB = 1024 * 1024;
// Said when a limit left files out, so the visitor knows why and by how much.
const limitNote = (token?: string) => `Some files were not scanned. For now we scan up to ${REPO_FILE_LIMIT} files, ${(token ? MAX_PRIVATE_DOWNLOAD_BYTES : MAX_DOWNLOAD_BYTES) / MB} MB to download and ${MAX_UNPACKED_BYTES / MB} MB unpacked.`;

type Result = Record<string, unknown> & { repo?: Record<string, unknown> };

@Injectable()
export class RepoScanService {
  private readonly logger = new Logger(RepoScanService.name);

  constructor(
    private readonly github: GithubClient,
    private readonly scans: ScanService,
    private readonly cache: RepoCache,
    private readonly muse: MuseClient,
  ) {}

  // A scan with a token is private. The token is used for this one scan and is passed down, never stored on the service.
  // A private scan never reads or writes the shared saved results, never clears one, and is not written to the 30 day record or the log.
  async scan(link: string, useModel: boolean, owner: string | undefined, signal: AbortSignal, token?: string, progress?: Progress): Promise<Result> {
    const parsed = parseRepoLink(link);
    if (!parsed) throw new BadRequestException('Use a link like https://github.com/owner/repository.');
    const latest = await this.github.resolve(parsed.owner, parsed.repo, parsed.refPath, signal, token);
    if (!latest) {
      if (token) throw new NotFoundException(NO_ACCESS);
      await this.cache.forget(`${parsed.owner}/${parsed.repo}`.toLowerCase());
      throw new NotFoundException(NOT_FOUND);
    }
    // A renamed repository is scanned, saved and shown under its current name.
    const ownerName = latest.owner ?? parsed.owner;
    const repoName = latest.repo ?? parsed.repo;
    const slug = `${ownerName}/${repoName}`.toLowerCase();
    // The key holds everything that changes the answer. A result made by the mock judge can never be served as a live one.
    const mode = this.muse.mode === 'live' ? this.muse.model : 'mock-judge';
    const key = [slug, latest.sha, SCANNER_VERSION, mode, useModel ? 'model' : 'rules'].join('|');
    const saved = token ? undefined : ((await this.cache.get(key)) as Result | undefined);
    // Clients are not told whether a result is saved. The server log keeps count.
    if (saved) {
      this.logger.log(`saved result served ${slug}@${latest.sha.slice(0, 7)}`);
      return saved;
    }

    // No joining of a scan another visitor started: it would end when that visitor leaves. Each visitor runs their own.
    return this.build(ownerName, repoName, slug, latest.sha, key, useModel, owner, signal, token, progress);
  }

  private async build(ownerName: string, repoName: string, slug: string, sha: string, key: string, useModel: boolean, owner: string | undefined, signal: AbortSignal, token?: string, progress?: Progress): Promise<Result> {
    progress?.('download');
    const zip = await this.github.download(ownerName, repoName, sha, signal, token);
    // One pass over the table of contents decides which files are scanned and counts what is left out, before anything is unpacked.
    const skipped: Record<string, number> = {};
    const scanned = new Set<string>();
    let pictures = 0;
    for (const zipPath of zipNames(zip)) {
      const path = zipPath.endsWith('/') ? null : insideRepo(zipPath);
      if (path === null || !isSafePath(path)) continue;
      const reason = skipReason(path);
      if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
      else if (isPicture(path) && pictures++ >= REPO_PICTURE_LIMIT) {
        const over = `pictures over the limit of ${REPO_PICTURE_LIMIT}`;
        skipped[over] = (skipped[over] ?? 0) + 1;
      } else scanned.add(zipPath);
    }
    // More files than the limit are not refused: the first ones are scanned and the rest are counted as not scanned.

    let read;
    try {
      read = readZip(zip, { maxEntries: REPO_FILE_LIMIT, maxEntryBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_UNPACKED_BYTES, keep: (name) => scanned.has(name) });
    } catch (error) {
      throw new BadRequestException(`This repository could not be read: ${(error as Error).message}`);
    }
    const files: UploadedFile[] = read.entries.map((entry) => {
      const path = insideRepo(entry.name) as string;
      const label = maskName(path.replace(/[^\x20-\x7e]/g, '_')).slice(-150);
      return { name: path, buffer: entry.data, fromArchive: true, label };
    });
    const result = (await this.scans.scanFiles(files, useModel, owner, signal, { prepared: true, label: token ? 'GitHub: private repository' : `GitHub: ${slug}`, persist: !token, progress })) as Result;
    const cleaned = { ...result, repo: { owner: ownerName, repo: repoName, sha, files: files.length, skipped: { ...skipped, ...read.skipped }, note: read.skipped['over the file limit'] || read.skipped['over the total size limit'] ? `${REPO_NOTE} ${limitNote(token)}` : REPO_NOTE } };
    if (token) {
      // The token is never in a result. If it ever were, the scan fails closed.
      if (JSON.stringify(cleaned).includes(token)) throw new InternalServerErrorException('Response blocked: it would have contained a token.');
      return cleaned;
    }
    // A result where the AI failed, timed out or hit a limit is not saved, so the next visitor gets a fresh try.
    const findings = (result.findings ?? []) as Array<{ judge?: { status?: string } }>;
    if (findings.some((finding) => ['error', 'timeout', 'limit'].includes(finding.judge?.status ?? ''))) return cleaned;
    const commit = await this.github.commitInfo(ownerName, repoName, sha, signal);
    await this.cache.set(key, slug, sha, cleaned, commit);
    return cleaned;
  }
}
