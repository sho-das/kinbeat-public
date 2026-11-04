import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ScanService } from '../scan.service';
import { UploadedFile } from '../extract/types';
import { GithubClient, OVER_300_FILES, TOKEN_BUSY } from './github.client';
import { changedLines, DiffLine } from './pr-diff';

// The last merged pull requests of a private repository, the changed lines of each, and each unique secret judged once.
export const PR_HISTORY_MAX = 100;
// Unique secrets sent to the judge in one scan, as one batch of model calls. Any more are listed as not checked.
export const PR_HISTORY_MAX_SECRETS = 30;
const MAX_LOCATIONS = 20;

interface Location {
  pr: number;
  path: string;
  line: number;
  kind: 'added' | 'removed';
}

interface HistorySecret {
  hash: string;
  type: string;
  preview: string;
  verdict: string;
  prs: number[];
  locations: Location[];
}

interface HistoryResult {
  repo: { owner: string; repo: string };
  pulls: number;
  skippedLarge: number;
  notRead: number;
  failedPulls: number;
  secrets: HistorySecret[];
  notChecked: number;
  note: string;
}

// One block per file and per kind of line (added or removed), with the line text only and nothing in front of it.
// A secret split over two lines, or a table header, is then read the same way as in the normal scan.
// Added and removed lines, and different files, stay in separate blocks, so they are never joined into one value.
const blocksFor = (pr: number, lines: DiffLine[]): Array<{ file: UploadedFile; lines: DiffLine[] }> => {
  const blocks: DiffLine[][] = [];
  for (const line of lines) {
    const last = blocks[blocks.length - 1];
    if (last && last[0].path === line.path && last[0].kind === line.kind) last.push(line);
    else blocks.push([line]);
  }
  return blocks.map((block, index) => ({
    lines: block,
    // The label is the name a finding carries back, so each block needs its own.
    file: { name: `pull-${pr}-${index + 1}.txt`, buffer: Buffer.from(block.map((line) => line.text).join('\n'), 'utf8'), fromArchive: true, label: `pull-${pr}-${index + 1}.txt` },
  }));
};

@Injectable()
export class PrHistoryService {
  constructor(
    private readonly github: GithubClient,
    private readonly scans: ScanService,
  ) {}

  async scan(owner: string, repo: string, wanted: number, signal: AbortSignal, token: string, useModel: boolean, progress: (done: number, total: number, step?: 'read' | 'ai') => void = () => {}, base?: string): Promise<HistoryResult> {
    const count = Math.min(Math.max(wanted, 1), PR_HISTORY_MAX);
    const numbers = await this.github.mergedPulls(owner, repo, count, signal, token, base);
    progress(0, numbers.length);

    // Pass 1: the rules only, one pull request at a time. Nothing is judged here, so this pass costs no model calls.
    const occurrences = new Map<string, { type: string; preview: string; first: DiffLine | null; all: Array<{ pr: number; line: DiffLine }> }>();
    let skippedLarge = 0;
    let notRead = 0;
    let failedPulls = 0;
    let pulled = 0;
    for (const pr of numbers) {
      signal.throwIfAborted();
      progress(pulled, numbers.length);
      pulled++;
      // One pull request that fails is counted as not checked. The other pull requests still run.
      let patch: string | null | typeof OVER_300_FILES;
      try {
        patch = await this.github.pullDiff(owner, repo, pr, signal, token);
        if (patch === OVER_300_FILES) {
          // GitHub refuses a diff this big, so the files are read page by page instead.
          const files = await this.github.pullFiles(owner, repo, pr, signal, token);
          patch = files ? files.patch : null;
          if (files) notRead += files.notRead;
        }
      } catch (error) {
        // A used-up GitHub allowance stops the whole scan, so the page reports it instead of a clean-looking partial result.
        if (signal.aborted || (error as Error).message === TOKEN_BUSY) throw error;
        failedPulls++;
        continue;
      }
      if (patch === null) {
        skippedLarge++;
        continue;
      }
      // An empty answer from GitHub is counted as not checked, so it cannot look like a clean pull request.
      const lines = changedLines(patch);
      if (lines.length === 0) {
        if (patch === '') failedPulls++;
        continue;
      }
      const blocks = blocksFor(pr, lines);
      const { findings } = (await this.scans.scanFiles(blocks.map((block) => block.file), false, undefined, signal, { prepared: true, label: 'GitHub: private pull requests', persist: false })) as { findings: Array<{ hash: string; type: string; preview: string; place: { file: string; line: number } }> };
      for (const finding of findings) {
        const line = blocks.find((block) => block.file.name === finding.place.file)?.lines[finding.place.line - 1];
        if (!line) continue;
        const entry = occurrences.get(finding.hash) ?? { type: finding.type, preview: finding.preview, first: null, all: [] };
        entry.all.push({ pr, line });
        entry.first ??= line;
        occurrences.set(finding.hash, entry);
      }
    }

    // Pass 2: each unique secret is judged once, from its first line only. Only the first PR_HISTORY_MAX_SECRETS are sent.
    // The AI check is its own step on the page, so reading shows complete and the AI row takes over.
    const unique = [...occurrences.entries()];
    progress(numbers.length, numbers.length, 'ai');
    const judged = unique.slice(0, PR_HISTORY_MAX_SECRETS);
    const judges = new Map<string, { status: string; mode?: string; verdict?: string; code?: string; reason?: string }>();
    if (judged.length > 0) {
      const judgeText = judged.map(([, entry]) => entry.first!.text).join('\n');
      const judgeFile: UploadedFile = { name: 'unique-secrets.txt', buffer: Buffer.from(judgeText, 'utf8'), fromArchive: true, label: 'GitHub: unique secrets' };
      const result = (await this.scans.scanFiles([judgeFile], useModel, undefined, signal, { prepared: true, label: 'GitHub: private pull requests', persist: false })) as { findings: Array<{ hash: string; judge: { status: string; mode?: string; verdict?: string; code?: string; reason?: string } }> };
      // Only fields with fixed values are kept: the status, the verdict and our own code and sentence.
      for (const { hash, judge } of result.findings) judges.set(hash, { status: judge.status, mode: judge.mode, verdict: judge.verdict, code: judge.code, reason: judge.reason });
    }

    const secrets: HistorySecret[] = judged.map(([hash, entry]) => ({
      hash,
      type: entry.type,
      preview: entry.preview,
      verdict: judges.get(hash)?.status === 'ok' ? (judges.get(hash)?.verdict ?? 'unsure') : 'unsure',
      prs: [...new Set(entry.all.map((item) => item.pr))].sort((a, b) => b - a),
      locations: entry.all.slice(0, MAX_LOCATIONS).map((item) => ({ pr: item.pr, path: item.line.path, line: item.line.line, kind: item.line.kind })),
    }));

    // One finding per secret, in the shape the page already shows. Its place is the first pull request it was found in.
    const findings = secrets.map((secret, index) => {
      const first = secret.locations[0];
      return {
        id: `f${index + 1}`,
        type: secret.type,
        encoding: 'plain',
        found: secret.type === 'generic_secret' ? 'Found because it looks like a password or secret.' : 'Found because it has the shape of an API key.',
        place: { file: `Pull request ${first?.pr ?? ''}`, line: first?.line ?? 0 },
        preview: secret.preview,
        hash: secret.hash,
        confidence: { level: secret.verdict === 'real' ? 'high' : 'medium', score: secret.verdict === 'real' ? 0.9 : 0.6 },
        judge: judges.get(secret.hash) ?? { status: 'skipped' },
      };
    });
    const result: HistoryResult & { mode: string; model: string; summary: { findings: number; blocked: number; errors: number }; findings: unknown[] } = {
      repo: { owner, repo },
      pulls: numbers.length,
      skippedLarge,
      notRead,
      failedPulls,
      secrets,
      notChecked: unique.length - judged.length,
      note: `Last ${numbers.length} merged pull requests${base ? ` into ${base}` : ''}. Only their added and removed lines were checked. Pull requests over 1 MB were not checked. Files with no text (too big for GitHub) were not checked: ${notRead}.`,
      mode: 'history',
      model: useModel ? 'muse' : 'rules',
      summary: { findings: findings.length, blocked: 0, errors: 0 },
      findings,
    };
    // The token is never in a result. If it ever were, the scan fails closed.
    if (JSON.stringify(result).includes(token)) throw new InternalServerErrorException('Response blocked: it would have contained a token.');
    return result;
  }
}
