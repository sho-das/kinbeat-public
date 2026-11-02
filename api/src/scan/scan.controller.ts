import { ArgumentsHost, BadRequestException, Body, Catch, Delete, ExceptionFilter, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Req, RequestTimeoutException, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/public';
import { visitorKey } from '../security/client-ip';
import { OneFileScanGuard, ScanRateLimitGuard, TokenScanRateLimitGuard } from '../security/rate-limit';
import { MAX_FILE_BYTES } from './extract/extractor.service';
import { positiveEnv } from './limits';
import { RepoScanService } from './repo/repo-scan.service';
import { parseRepoLink } from './repo/repo-rules';
import { PR_HISTORY_MAX, PrHistoryService } from './repo/pr-history.service';
import { PrHistoryJobs } from './repo/pr-history.job';
import { ScanCancelled, ScanService } from './scan.service';
import { ScanProgress } from './progress';
import { SiteScanService } from './site/site-scan.service';
import { getTemplate, publicTemplate, TEMPLATES } from './templates';
import { Unit } from './types';

// The upload library answers a second file, or a file in another field, with 'Too many files' or 'Unexpected ...'.
const isUploadLimitError = (message: unknown) => typeof message === 'string' && (message === 'Too many files' || message.startsWith('Unexpected'));

@Catch(BadRequestException)
class OneFileFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const body = exception.getResponse();
    const message = typeof body === 'object' ? (body as { message?: unknown }).message : body;
    const reply = isUploadLimitError(message) ? { statusCode: 400, error: 'Bad Request', message: 'Send one file, in the field "file".' } : body;
    host.switchToHttp().getResponse().status(exception.getStatus()).json(reply);
  }
}

// A GitHub token: fine-grained (github_pat_) or classic (ghp_ and the other prefixes). Checked before any call to GitHub.
const GITHUB_TOKEN = /^(github_pat_[A-Za-z0-9_]{20,240}|gh[pousr]_[A-Za-z0-9]{20,240})$/;

interface ClientGone {
  writableEnded: boolean;
  setHeader(name: string, value: string): unknown;
  locals?: Record<string, unknown>;
  on(event: 'close', listener: () => void): unknown;
}

// Aborts when the browser leaves before the answer is sent, so the scan stops spending model calls.
function leaves(res: ClientGone): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

// A scan that stops when the visitor leaves or the deadline passes. The OneFileScanGuard waits for the work kept in res.locals.
function timed<T>(res: ClientGone & { locals?: Record<string, unknown> }, tooLong: string, run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const gone = leaves(res);
  const deadline = AbortSignal.timeout(positiveEnv('SCAN_DEADLINE_SECONDS', 90) * 1000);
  const work = run(AbortSignal.any([gone, deadline])).catch((error) => {
    if (deadline.aborted && !gone.aborted) throw new RequestTimeoutException(tooLong);
    if (gone.aborted) return undefined;
    throw error;
  });
  res.locals = { ...res.locals, scanWork: work };
  return work;
}

const quietIfCancelled = (error: unknown) => {
  if (error instanceof ScanCancelled) return undefined;
  throw error;
};

const MAX_TEXT = 10_000;

@Public()
@Controller()
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly repoScan: RepoScanService,
    private readonly prHistory: PrHistoryService,
    private readonly historyJobs: PrHistoryJobs,
    private readonly progress: ScanProgress,
    private readonly siteScan: SiteScanService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('templates')
  templates() {
    return TEMPLATES.map(publicTemplate);
  }

  @Get('templates/:id')
  template(@Param('id') id: string) {
    const template = getTemplate(id);
    if (!template) throw new NotFoundException(`No template with id ${id}`);
    return publicTemplate(template);
  }

  @Post('scan')
  @UseGuards(ScanRateLimitGuard)
  @HttpCode(200)
  scan(@Body() body: { text?: unknown; templateId?: unknown; useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone, @Headers('x-progress-id') progressId?: string) {
    const { text, templateId, useModel } = body ?? {};
    const signal = leaves(res);
    const progress = this.progress.reporter(visitorKey(req), progressId);
    if (useModel !== undefined && typeof useModel !== 'boolean') {
      throw new BadRequestException('useModel must be true or false');
    }
    if (typeof templateId === 'string' && templateId) {
      const template = getTemplate(templateId);
      if (!template) throw new NotFoundException(`No template with id ${templateId}`);
      const unit: Unit = template.kind === 'chat' ? 'message' : 'line';
      return this.scanService.scan({ text: template.lines.join('\n'), unit, useModel: useModel ?? true, templateId, owner: visitorKey(req), signal, progress }).catch(quietIfCancelled);
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new BadRequestException('Send text or templateId');
    }
    if (text.length > MAX_TEXT) throw new BadRequestException(`text is longer than ${MAX_TEXT} characters`);
    return this.scanService.scan({ text, unit: 'line', useModel: useModel ?? true, owner: visitorKey(req), signal, progress }).catch(quietIfCancelled);
  }

  @Post('scan/file')
  @UseGuards(ScanRateLimitGuard, OneFileScanGuard)
  @UseFilters(OneFileFilter)
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: MAX_FILE_BYTES } }))
  scanFile(@UploadedFile() file: { originalname: string; buffer: Buffer } | undefined, @Body() body: { useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone, @Headers('x-progress-id') progressId?: string) {
    const raw = body?.useModel;
    if (raw !== undefined && raw !== 'true' && raw !== 'false') {
      throw new BadRequestException('useModel must be true or false');
    }
    if (!file) throw new BadRequestException('Send one file, in the field "file".');
    // One overall time limit per file scan. It is checked between pages, pictures, files and model calls, so it frees the
    // visitor and the slot; a reader stuck inside its own code cannot be interrupted until it returns.
    const gone = leaves(res);
    const deadline = AbortSignal.timeout(positiveEnv('SCAN_DEADLINE_SECONDS', 90) * 1000);
    const work = this.scanService.scanFiles([{ name: file.originalname, buffer: file.buffer }], raw !== 'false', visitorKey(req), AbortSignal.any([gone, deadline]), { progress: this.progress.reporter(visitorKey(req), progressId) }).catch((error) => {
      if (error instanceof ScanCancelled && deadline.aborted && !gone.aborted) {
        throw new RequestTimeoutException('This file took too long to read, so the scan was stopped. Try a smaller file.');
      }
      return quietIfCancelled(error);
    });
    res.locals = { ...res.locals, scanWork: work };
    return work;
  }

  // A public GitHub repository, current files only. A scan is shared: while the latest commit is the same, every visitor gets the saved result.
  // With a token the scan is private: nothing is shared, saved or logged, and the token is never echoed in an answer.
  @Post('scan/repo')
  @UseGuards(ScanRateLimitGuard, TokenScanRateLimitGuard, OneFileScanGuard)
  @HttpCode(200)
  scanRepo(@Body() body: { url?: unknown; useModel?: unknown; token?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone, @Headers('x-progress-id') progressId?: string) {
    const { url, useModel, token } = body ?? {};
    if (typeof url !== 'string' || !url.trim() || url.length > 300) throw new BadRequestException('Use a link like https://github.com/owner/repository.');
    if (useModel !== undefined && typeof useModel !== 'boolean') throw new BadRequestException('useModel must be true or false');
    let privateToken: string | undefined;
    if (token !== undefined) {
      if (typeof token !== 'string' || !GITHUB_TOKEN.test(token.trim())) throw new BadRequestException('That is not a GitHub token.');
      privateToken = token.trim();
      res.setHeader('Cache-Control', 'no-store');
    }
    return timed(res, 'This repository took too long to scan, so the scan was stopped.', (signal) =>
      this.repoScan.scan(url, useModel ?? true, visitorKey(req), signal, privateToken, this.progress.reporter(visitorKey(req), progressId)),
    );
  }

  // One public web page and the script files it loads. Private and local addresses are refused - see site/safe-fetch.ts.
  @Post('scan/site')
  @UseGuards(ScanRateLimitGuard, OneFileScanGuard)
  @HttpCode(200)
  scanSite(@Body() body: { url?: unknown; useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone, @Headers('x-progress-id') progressId?: string) {
    const { url, useModel } = body ?? {};
    if (typeof url !== 'string' || !url.trim() || url.length > 300) throw new BadRequestException('Use a web address like https://example.com.');
    if (useModel !== undefined && typeof useModel !== 'boolean') throw new BadRequestException('useModel must be true or false');
    return timed(res, 'This website took too long to scan, so the scan was stopped.', (signal) =>
      this.siteScan.scan(url, useModel ?? true, visitorKey(req), signal, this.progress.reporter(visitorKey(req), progressId)),
    );
  }

  // The last 100 merged pull requests of a repository, as a background job. Only a token from the visitor is accepted.
  // The answer is an id to check; the result is read with the id, by the same visitor only.
  @Post('scan/repo/history')
  @UseGuards(ScanRateLimitGuard, TokenScanRateLimitGuard)
  @HttpCode(202)
  async startHistory(@Body() body: { url?: unknown; token?: unknown; useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    const { url, token, useModel } = body ?? {};
    const link = typeof url === 'string' && url.length <= 300 ? parseRepoLink(url) : null;
    if (!link) throw new BadRequestException('Use a link like https://github.com/owner/repository.');
    if (typeof token !== 'string' || !GITHUB_TOKEN.test(token.trim())) throw new BadRequestException('That is not a GitHub token.');
    if (useModel !== undefined && typeof useModel !== 'boolean') throw new BadRequestException('useModel must be true or false');
    const privateToken = token.trim();
    res.setHeader('Cache-Control', 'no-store');
    const job = this.historyJobs.start(visitorKey(req), privateToken, (progress, signal) =>
      this.prHistory.scan(link.owner, link.repo, PR_HISTORY_MAX, AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]), privateToken, useModel ?? true, progress),
    );
    return { id: job.id, state: job.state, done: job.done, total: job.total };
  }

  // The step a running scan is at, for the page to show while it waits. Only the visitor who started the scan can read it.
  @Get('scan/progress/:id')
  scanProgress(@Param('id') id: string, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    res.setHeader('Cache-Control', 'no-store');
    const state = this.progress.get(visitorKey(req), id);
    if (!state) throw new NotFoundException('No progress for this scan yet.');
    return state;
  }

  // Stops a scan on the server. Only the visitor who started it can stop it.
  @Delete('scan/repo/history/:id')
  @HttpCode(200)
  cancelHistory(@Param('id') id: string, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    res.setHeader('Cache-Control', 'no-store');
    if (!this.historyJobs.cancel(id, visitorKey(req))) throw new NotFoundException('This scan was not found, or it has already ended.');
    return { stopped: true };
  }

  @Get('scan/repo/history/:id')
  history(@Param('id') id: string, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    res.setHeader('Cache-Control', 'no-store');
    const job = this.historyJobs.get(id, visitorKey(req));
    if (!job) throw new NotFoundException('This scan was not found. It may have expired.');
    return {
      id: job.id,
      state: job.state,
      done: job.done,
      total: job.total,
      ...(job.state === 'done' ? { result: job.result } : {}),
      ...(job.state === 'failed' ? { error: job.error } : {}),
    };
  }
}
