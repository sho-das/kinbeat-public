import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { clearRecentCandidates, findCandidates } from './candidates';
import { ScanLog } from './scan.log';
import { Hasher } from './hasher';
import { mask } from './masker';
import { MuseClient } from './muse.client';
import { buildSlice, FindingParts, findingLeak, forbiddenStrings, withhold } from './scrubber';
import { buildFacts } from './facts';
import { ScanBudget } from './budget';
import { mapLimit, numberEnv } from './limits';
import { knownPlaceholder } from './placeholders';
import { ExtractorService } from './extract/extractor.service';
import { cleanName } from './extract/sniff';
import { PictureBudget } from './extract/picture-reader';
import { ExtractCancelled, READ_CONFIDENCE_DROP, READ_SOURCES, Segment, UploadedFile } from './extract/types';
import { Candidate, JudgeResult, Level, Unit } from './types';

export class ScanCancelled extends Error {
  constructor() {
    super('Scan cancelled: the client left.');
  }
}

interface ScanInput {
  text: string;
  unit: Unit;
  useModel: boolean;
  templateId?: string;
  owner?: string;
  signal?: AbortSignal;
}

interface JudgeOutput extends Partial<Omit<JudgeResult, 'status'>> {
  status: 'ok' | 'error' | 'timeout' | 'unverified' | 'limit' | 'blocked' | 'skipped';
  slice?: string;
  facts?: string;
  error?: string;
}

interface JudgeJob {
  text: string;
  candidate: Candidate;
  all: Candidate[];
  fileName?: string;
}

const levelOf = (score: number): Level => (score >= 0.85 ? 'high' : score >= 0.55 ? 'medium' : 'low');

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private readonly muse: MuseClient,
    private readonly hasher: Hasher,
    private readonly extractor: ExtractorService,
    private readonly scanLog: ScanLog,
  ) {}

  // The recent-text memory in findCandidates only needs to live for one scan, so it is emptied when the scan ends.
  // With prepared set, the caller has already chosen and unpacked the files (a repository scan), so they are not checked again.
  async scanFiles(files: UploadedFile[], useModel: boolean, owner?: string, signal?: AbortSignal, options: { prepared?: boolean; label?: string } = {}) {
    try {
      return await this.runScanFiles(files, useModel, owner, signal, options);
    } finally {
      clearRecentCandidates();
    }
  }

  async scan(input: ScanInput) {
    try {
      return await this.runScan(input);
    } finally {
      clearRecentCandidates();
    }
  }

  private async runScanFiles(files: UploadedFile[], useModel: boolean, owner: string | undefined, signal: AbortSignal | undefined, options: { prepared?: boolean; label?: string }) {
    const startedAt = Date.now();
    if (!options.prepared) this.extractor.check(files);
    const expanded = options.prepared ? { files, reports: [] } : this.extractor.expand(files);
    const segments: Segment[] = [];
    const reports = [...expanded.reports];
    const pictures = new PictureBudget();
    for (const file of expanded.files) {
      if (signal?.aborted) throw new ScanCancelled();
      try {
        const extraction = await this.extractor.extract(file, signal, pictures);
        segments.push(...extraction.segments);
        reports.push(extraction.report);
      } catch (error) {
        if (error instanceof ExtractCancelled) throw new ScanCancelled();
        if (!file.fromArchive) throw error;
        reports.push({ file: file.name, type: 'unreadable', note: 'This file inside the archive could not be read and was skipped.' });
      }
    }

    const budget = new ScanBudget();
    const forbidden = new Set<string>();
    const findings = [];
    const forbiddenOf: string[][] = [];
    const jobs: JudgeJob[] = [];
    for (const segment of segments) {
      const candidates = findCandidates(segment.text);
      const segmentForbidden = forbiddenStrings(segment.text, candidates);
      for (const item of segmentForbidden) forbidden.add(item);
      const lineOf = this.lineFinder(segment.text);
      const drop = READ_SOURCES.includes(segment.source) ? READ_CONFIDENCE_DROP : 0;
      for (const candidate of candidates) {
        const hash = this.hasher.hash(candidate.value);
        const score = this.round(candidate.score - drop);
        forbiddenOf.push(segmentForbidden);
        findings.push({
          id: `f${findings.length + 1}`,
          type: candidate.type,
          encoding: candidate.encoding,
          source: segment.source,
          place: {
            file: segment.file,
            ...(segment.page !== undefined ? { page: segment.page } : {}),
            line: lineOf(candidate.spans[0].start),
          },
          preview: mask(candidate.value),
          hash,
          confidence: { level: levelOf(score), score },
          judge: { status: 'skipped' } as JudgeOutput,
        });
        jobs.push({ text: segment.text, candidate, all: candidates, fileName: segment.file });
      }
    }

    await this.judgeAll(jobs, findings, useModel, budget, owner, signal);
    const safeFindings = findings.map((finding, index) => (findingLeak(finding, forbiddenOf[index]) ? withhold(finding) : finding));
    const unread = reports.reduce((n, report) => n + (report.notRead ? 1 : 0) + (report.notReadPages?.length ?? 0), 0);
    const forbiddenList = [...forbidden];
    const safeReports = reports.map((report) => (this.reportLeaks(report, forbiddenList) ? { file: '[file name hidden]', type: report.type } : report));

    const result = {
      source: { files: safeReports.length },
      mode: this.muse.mode,
      model: this.muse.mode === 'live' ? this.muse.model : 'mock-judge',
      files: safeReports,
      confidenceNote: `Findings read from pictures or scanned pages (sources image-read and pdf-read) have their confidence lowered by ${READ_CONFIDENCE_DROP}, because reading text from a picture can make mistakes and miss secrets.`,
      summary: { ...this.summarize(safeFindings), unread },
      findings: safeFindings,
    };

    this.assertClean(result.findings, forbiddenOf);
    this.logger.log(`file scan done files=${reports.length} findings=${findings.length} mode=${result.mode}`);
    const scanId = await this.scanLog.record({ kind: 'files', label: options.label ?? files.map((f) => cleanName(f.name)).join(', '), files: files.length, startedAt }, result);
    return { ...result, scanId };
  }

  // A finding that still leaks after it was withheld means the guard itself is broken, so the scan fails closed.
  private assertClean(findings: FindingParts[], forbiddenOf: string[][]): void {
    if (findings.some((finding, index) => findingLeak(finding, forbiddenOf[index]) !== null)) {
      this.logger.error('response blocked: plaintext found in output');
      throw new InternalServerErrorException('Response blocked: it would have contained a plaintext secret.');
    }
  }

  private reportLeaks(report: { file: string; note?: string }, forbidden: string[]): boolean {
    return findingLeak({ preview: report.file, place: { file: report.note ?? '' } }, forbidden) !== null;
  }

  private summarize(findings: Array<{ judge: JudgeOutput }>) {
    const count = (status: string) => findings.filter((f) => f.judge.status === status).length;
    return {
      findings: findings.length,
      blocked: count('blocked'),
      errors: count('error'),
      unverified: count('unverified'),
      timeouts: count('timeout'),
      limited: count('limit'),
      widened: findings.filter((f) => f.judge.widened).length,
    };
  }

  private round(score: number): number {
    return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  }

  private lineFinder(text: string) {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
    // The last line that starts at or before the offset, found by halving the range.
    return (offset: number) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };
  }

  private async runScan(input: ScanInput) {
    const startedAt = Date.now();
    const { text, unit } = input;
    const candidates = findCandidates(text);
    const lineOf = this.lineFinder(text);

    const budget = new ScanBudget();
    const findings = [];
    const jobs: JudgeJob[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const first = lineOf(candidate.spans[0].start);
      const last = lineOf(candidate.spans[candidate.spans.length - 1].start);
      const score = this.round(candidate.score);
      findings.push({
        id: `f${index + 1}`,
        type: candidate.type,
        encoding: candidate.encoding,
        place: last > first ? { unit, index: first, endIndex: last } : { unit, index: first },
        preview: mask(candidate.value),
        hash: this.hasher.hash(candidate.value),
        confidence: { level: levelOf(score), score },
        judge: { status: 'skipped' } as JudgeOutput,
      });
      jobs.push({ text, candidate, all: candidates });
    }
    await this.judgeAll(jobs, findings, input.useModel, budget, input.owner, input.signal);

    const forbidden = forbiddenStrings(text, candidates);
    const safeFindings = findings.map((finding) => (findingLeak(finding, forbidden) ? withhold(finding) : finding));
    const result = {
      source: input.templateId ? { templateId: input.templateId, unit } : { unit },
      mode: this.muse.mode,
      model: this.muse.mode === 'live' ? this.muse.model : 'mock-judge',
      summary: this.summarize(safeFindings),
      findings: safeFindings,
    };

    this.assertClean(result.findings, safeFindings.map(() => forbidden));
    this.logger.log(`scan done findings=${findings.length} mode=${result.mode} model=${result.model}`);
    const scanId = await this.scanLog.record({ kind: input.templateId ? 'template' : 'text', label: input.templateId ?? 'Pasted text', chars: text.length, startedAt }, result);
    return { ...result, scanId };
  }

  // Judges the findings several at a time. Each result goes back to its own finding, so the order never changes.
  private async judgeAll(jobs: JudgeJob[], findings: Array<{ judge: JudgeOutput }>, useModel: boolean, budget: ScanBudget, owner?: string, signal?: AbortSignal): Promise<void> {
    const judged = await mapLimit(jobs, numberEnv('SCAN_JUDGE_CONCURRENCY', 6), (job) => this.judge(job.text, job.candidate, job.all, useModel, budget, job.fileName, owner, signal), signal);
    if (signal?.aborted) throw new ScanCancelled();
    judged.forEach((judge, index) => {
      findings[index].judge = judge;
    });
  }

  private async judge(text: string, candidate: Candidate, all: Candidate[], useModel: boolean, budget: ScanBudget, fileName?: string, owner?: string, signal?: AbortSignal): Promise<JudgeOutput> {
    if (!useModel) return { status: 'skipped' };
    const placeholder = knownPlaceholder(candidate.value);
    if (placeholder) {
      return { status: 'ok', mode: 'rule', model: 'rule', verdict: 'example', confidence: 0.95, reason: `Matches a known placeholder list (${placeholder}). No AI check was run.`, verified: true, calls: 0 };
    }
    const scrubbed = buildSlice(text, candidate, all);
    if (!scrubbed.ok) {
      this.logger.warn(`judge blocked type=${candidate.type}`);
      return { status: 'blocked', error: scrubbed.error };
    }
    const facts = buildFacts(text, candidate, fileName, all);
    const result = await this.muse.judgeVerified((width) => buildSlice(text, candidate, all, width), { facts, budget, owner, signal });
    const shown = result.widened && result.width ? buildSlice(text, candidate, all, result.width) : scrubbed;
    return { ...result, slice: shown.ok ? shown.slice : scrubbed.slice, facts };
  }
}
