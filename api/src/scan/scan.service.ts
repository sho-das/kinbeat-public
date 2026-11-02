import { foundBecause } from './found-because';
import { maskedLine } from './line';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { clearRecentCandidates, findCandidates } from './candidates';
import { ScanLog } from './scan.log';
import { Hasher } from './hasher';
import { mask } from './masker';
import { BatchItem, MuseClient } from './muse.client';
import { buildRawSlice, buildSlice, FindingParts, findingLeak, forbiddenStrings, SLICE_WIDTHS, withhold } from './scrubber';
import { buildFacts } from './facts';
import { ScanBudget } from './budget';
import { knownPlaceholder } from './placeholders';
import { fixedReason, sentence } from './reasons';
import { ExtractorService } from './extract/extractor.service';
import { cleanName } from './extract/sniff';
import { PictureBudget } from './extract/picture-reader';
import { ExtractCancelled, READ_CONFIDENCE_DROP, READ_SOURCES, Segment, UploadedFile } from './extract/types';
import { Candidate, JudgeResult, Level, Unit } from './types';
import { Progress } from './progress';
import { isPicture } from './repo/repo-rules';

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
  progress?: Progress;
}

interface JudgeOutput extends Partial<Omit<JudgeResult, 'status'>> {
  status: 'ok' | 'error' | 'timeout' | 'unverified' | 'limit' | 'blocked' | 'skipped';
  slice?: string;
  facts?: string;
}

interface JudgeJob {
  text: string;
  candidate: Candidate;
  all: Candidate[];
  fileName?: string;
  line?: number;
}

// A secret's value is shown to the AI only when no other secret sits inside it or around it, so one value never reveals another.
const ownValue = (candidate: Candidate, all: Candidate[]): string | undefined =>
  all.some((other) => other !== candidate && other.value !== candidate.value && (candidate.value.includes(other.value) || other.value.includes(candidate.value))) ? undefined : candidate.value;

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
  async scanFiles(files: UploadedFile[], useModel: boolean, owner?: string, signal?: AbortSignal, options: { prepared?: boolean; label?: string; persist?: boolean; progress?: Progress; maxFindings?: number } = {}) {
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

  private async runScanFiles(files: UploadedFile[], useModel: boolean, owner: string | undefined, signal: AbortSignal | undefined, options: { prepared?: boolean; label?: string; persist?: boolean; progress?: Progress; maxFindings?: number }) {
    const startedAt = Date.now();
    if (!options.prepared) this.extractor.check(files);
    const expanded = options.prepared ? { files, reports: [] } : this.extractor.expand(files);
    const segments: Segment[] = [];
    const reports = [...expanded.reports];
    const pictures = new PictureBudget();
    // Pictures and other files are counted apart, since each picture is one slow AI call.
    const pictureCount = expanded.files.filter((file) => isPicture(file.name)).length;
    const read = { files: 0, pictures: 0 };
    for (const file of expanded.files) {
      if (signal?.aborted) throw new ScanCancelled();
      if (isPicture(file.name)) options.progress?.('pictures', ++read.pictures, pictureCount);
      else options.progress?.('files', ++read.files, expanded.files.length - pictureCount);
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
          found: foundBecause(segment.text, candidate),
          line: maskedLine(segment.text, candidates, candidate, segmentForbidden),
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
        jobs.push({ text: segment.text, candidate, all: candidates, fileName: segment.file, line: lineOf(candidate.spans[0].start) });
      }
    }

    // A free scan with a limit keeps only its first findings, so the AI step stays small.
    if (options.maxFindings !== undefined && findings.length > options.maxFindings) {
      findings.length = options.maxFindings;
      jobs.length = options.maxFindings;
      forbiddenOf.length = options.maxFindings;
    }
    await this.judgeAll(jobs, findings, useModel, budget, owner, signal, options.progress);
    const safeFindings = findings.map((finding, index) => (findingLeak(finding, forbiddenOf[index]) ? withhold(finding, forbiddenOf[index]) : finding));
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
    // persist false: nothing about this scan is written to the 30 day record (a private repository).
    const scanId = options.persist === false ? undefined : await this.scanLog.record({ kind: 'files', label: options.label ?? files.map((f) => cleanName(f.name)).join(', '), files: files.length, startedAt }, result);
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
    const forbidden = forbiddenStrings(text, candidates);

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
        found: foundBecause(text, candidate),
        line: maskedLine(text, candidates, candidate, forbidden),
        place: last > first ? { unit, index: first, endIndex: last } : { unit, index: first },
        preview: mask(candidate.value),
        hash: this.hasher.hash(candidate.value),
        confidence: { level: levelOf(score), score },
        judge: { status: 'skipped' } as JudgeOutput,
      });
      jobs.push({ text, candidate, all: candidates, line: first });
    }
    await this.judgeAll(jobs, findings, input.useModel, budget, input.owner, input.signal, input.progress);

    const safeFindings = findings.map((finding) => (findingLeak(finding, forbidden) ? withhold(finding, forbidden) : finding));
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

  // Judges all findings together: each step of the AI check is one call for the whole scan (see MuseClient.judgeBatch).
  private async judgeAll(jobs: JudgeJob[], findings: Array<{ judge: JudgeOutput }>, useModel: boolean, budget: ScanBudget, owner?: string, signal?: AbortSignal, progress?: Progress): Promise<void> {
    if (!useModel) return;
    const items: BatchItem[] = [];
    jobs.forEach((job, index) => {
      const placeholder = knownPlaceholder(job.candidate.value);
      if (placeholder) {
        findings[index].judge = { status: 'ok', mode: 'rule', model: 'rule', verdict: 'example', code: 'KNOWN_EXAMPLE', reason: sentence('KNOWN_EXAMPLE'), verified: true };
        return;
      }
      // Our own AI server gets the raw text, so a masked slice that is blocked does not stop the check there.
      const scrubbed = buildSlice(job.text, job.candidate, job.all);
      if (!scrubbed.ok && !this.muse.sendsRaw) {
        this.logger.warn(`judge blocked type=${job.candidate.type}`);
        findings[index].judge = { status: 'blocked', code: 'LEAK_GUARD', reason: sentence('LEAK_GUARD') };
        return;
      }
      const id = String(index);
      items.push({ id, type: job.candidate.type, file: job.fileName, line: job.line, facts: buildFacts(job.text, job.candidate, job.fileName, job.all), value: ownValue(job.candidate, job.all), ...(job.candidate.weak ? { weak: true } : {}), slice: (width) => buildSlice(job.text, job.candidate, job.all, width), raw: (width) => buildRawSlice(job.text, job.candidate, width) });
    });
    if (items.length > 0) await this.judgeItems(items, findings, budget, owner, signal, progress);
    // The last guard: every reason that leaves this service is one of our fixed sentences.
    for (const finding of findings) finding.judge = fixedReason(finding.judge);
  }

  private async judgeItems(items: BatchItem[], findings: Array<{ judge: JudgeOutput }>, budget: ScanBudget, owner?: string, signal?: AbortSignal, progress?: Progress): Promise<void> {
    const { results, calls } = await this.muse.judgeBatch(items, { budget, owner, signal, progress });
    if (signal?.aborted) throw new ScanCancelled();
    this.logger.log(`judge batch findings=${items.length} calls=${calls}`);
    for (const item of items) {
      const result = results.get(item.id)!;
      const shown = item.slice(result.width ?? SLICE_WIDTHS[0]);
      findings[Number(item.id)].judge = { ...result, slice: shown.ok ? shown.slice : undefined, facts: item.facts };
    }
  }
}
