import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MuseClient } from '../muse.client';
import { ScanService } from '../scan.service';
import { maskName } from '../scrubber';
import { UploadedFile } from '../extract/types';
import { isSafePath, readZip, zipNames } from '../extract/zip';
import { GithubClient } from './github.client';
import { insideRepo, parseRepoLink, skipReason } from './repo-rules';
import { RepoCache } from './repo.cache';

export const REPO_FILE_LIMIT = 200;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SCANNER_VERSION = '1';
const NOT_FOUND = 'Repository not found, or it is not public.';
export const REPO_NOTE = 'Current files only. Old commits and deleted files were not checked.';

type Result = Record<string, unknown> & { repo?: Record<string, unknown> };

@Injectable()
export class RepoScanService {
  private readonly running = new Map<string, Promise<Result>>();

  constructor(
    private readonly github: GithubClient,
    private readonly scans: ScanService,
    private readonly cache: RepoCache,
    private readonly muse: MuseClient,
  ) {}

  async scan(link: string, useModel: boolean, owner: string | undefined, signal: AbortSignal): Promise<Result> {
    const parsed = parseRepoLink(link);
    if (!parsed) throw new BadRequestException('Use a link like https://github.com/owner/repository.');
    const slug = `${parsed.owner}/${parsed.repo}`.toLowerCase();
    const latest = await this.github.resolve(parsed.owner, parsed.repo, parsed.refPath, signal);
    if (!latest) {
      this.cache.forget(slug);
      throw new NotFoundException(NOT_FOUND);
    }
    // The key holds everything that changes the answer. A result made by the mock judge can never be served as a live one.
    const mode = this.muse.mode === 'live' ? this.muse.model : 'mock-judge';
    const key = [slug, latest.sha, SCANNER_VERSION, mode, useModel ? 'model' : 'rules'].join('|');
    const saved = this.cache.get(key) as Result | undefined;
    if (saved) return { ...saved, repo: { ...saved.repo, cached: true } };

    const running = this.running.get(key);
    if (running) return running;
    const work = this.build(parsed.owner, parsed.repo, slug, latest.sha, key, useModel, owner, signal).finally(() => this.running.delete(key));
    this.running.set(key, work);
    return work;
  }

  private async build(ownerName: string, repoName: string, slug: string, sha: string, key: string, useModel: boolean, owner: string | undefined, signal: AbortSignal): Promise<Result> {
    const zip = await this.github.download(ownerName, repoName, sha, signal);
    // One pass over the table of contents decides which files are scanned and counts what is left out, before anything is unpacked.
    const skipped: Record<string, number> = {};
    const scanned = new Set<string>();
    for (const zipPath of zipNames(zip)) {
      const path = zipPath.endsWith('/') ? null : insideRepo(zipPath);
      if (path === null || !isSafePath(path)) continue;
      const reason = skipReason(path);
      if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
      else scanned.add(zipPath);
    }
    if (scanned.size > REPO_FILE_LIMIT) throw new BadRequestException(`This repository has ${scanned.size} files to scan. The limit is ${REPO_FILE_LIMIT}.`);

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
    const result = (await this.scans.scanFiles(files, useModel, owner, signal, { prepared: true, label: `GitHub: ${slug}` })) as Result;
    const cleaned = { ...result, repo: { owner: ownerName, repo: repoName, sha, scannedAt: new Date().toISOString(), files: files.length, skipped: { ...skipped, ...read.skipped }, cached: false, note: REPO_NOTE } };
    this.cache.set(key, slug, cleaned);
    return cleaned;
  }
}
