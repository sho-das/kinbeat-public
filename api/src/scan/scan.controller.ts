import { ArgumentsHost, BadRequestException, Body, Catch, ExceptionFilter, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, RequestTimeoutException, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/public';
import { visitorKey } from '../security/client-ip';
import { OneFileScanGuard, ScanRateLimitGuard } from '../security/rate-limit';
import { MAX_FILE_BYTES } from './extract/extractor.service';
import { positiveEnv } from './limits';
import { RepoScanService } from './repo/repo-scan.service';
import { ScanCancelled, ScanService } from './scan.service';
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

interface ClientGone {
  writableEnded: boolean;
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

const quietIfCancelled = (error: unknown) => {
  if (error instanceof ScanCancelled) return undefined;
  throw error;
};

const MAX_TEXT = 200_000;

@Public()
@Controller()
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly repoScan: RepoScanService,
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
  scan(@Body() body: { text?: unknown; templateId?: unknown; useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    const { text, templateId, useModel } = body ?? {};
    const signal = leaves(res);
    if (useModel !== undefined && typeof useModel !== 'boolean') {
      throw new BadRequestException('useModel must be true or false');
    }
    if (typeof templateId === 'string' && templateId) {
      const template = getTemplate(templateId);
      if (!template) throw new NotFoundException(`No template with id ${templateId}`);
      const unit: Unit = template.kind === 'chat' ? 'message' : 'line';
      return this.scanService.scan({ text: template.lines.join('\n'), unit, useModel: useModel ?? true, templateId, owner: visitorKey(req), signal }).catch(quietIfCancelled);
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new BadRequestException('Send text or templateId');
    }
    if (text.length > MAX_TEXT) throw new BadRequestException(`text is longer than ${MAX_TEXT} characters`);
    return this.scanService.scan({ text, unit: 'line', useModel: useModel ?? true, owner: visitorKey(req), signal }).catch(quietIfCancelled);
  }

  @Post('scan/file')
  @UseGuards(ScanRateLimitGuard, OneFileScanGuard)
  @UseFilters(OneFileFilter)
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: MAX_FILE_BYTES } }))
  scanFile(@UploadedFile() file: { originalname: string; buffer: Buffer } | undefined, @Body() body: { useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    const raw = body?.useModel;
    if (raw !== undefined && raw !== 'true' && raw !== 'false') {
      throw new BadRequestException('useModel must be true or false');
    }
    if (!file) throw new BadRequestException('Send one file, in the field "file".');
    // One overall time limit per file scan. It is checked between pages, pictures, files and model calls, so it frees the
    // visitor and the slot; a reader stuck inside its own code cannot be interrupted until it returns.
    const gone = leaves(res);
    const deadline = AbortSignal.timeout(positiveEnv('SCAN_DEADLINE_SECONDS', 90) * 1000);
    const work = this.scanService.scanFiles([{ name: file.originalname, buffer: file.buffer }], raw !== 'false', visitorKey(req), AbortSignal.any([gone, deadline])).catch((error) => {
      if (error instanceof ScanCancelled && deadline.aborted && !gone.aborted) {
        throw new RequestTimeoutException('This file took too long to read, so the scan was stopped. Try a smaller file.');
      }
      return quietIfCancelled(error);
    });
    res.locals = { ...res.locals, scanWork: work };
    return work;
  }

  // A public GitHub repository, current files only. A scan is shared: while the latest commit is the same, every visitor gets the saved result.
  @Post('scan/repo')
  @UseGuards(ScanRateLimitGuard, OneFileScanGuard)
  @HttpCode(200)
  scanRepo(@Body() body: { url?: unknown; useModel?: unknown }, @Req() req: { ip?: string }, @Res({ passthrough: true }) res: ClientGone) {
    const { url, useModel } = body ?? {};
    if (typeof url !== 'string' || !url.trim() || url.length > 300) throw new BadRequestException('Use a link like https://github.com/owner/repository.');
    if (useModel !== undefined && typeof useModel !== 'boolean') throw new BadRequestException('useModel must be true or false');
    const gone = leaves(res);
    const deadline = AbortSignal.timeout(positiveEnv('SCAN_DEADLINE_SECONDS', 90) * 1000);
    const work = this.repoScan.scan(url, useModel ?? true, visitorKey(req), AbortSignal.any([gone, deadline])).catch((error) => {
      if (deadline.aborted && !gone.aborted) throw new RequestTimeoutException('This repository took too long to scan, so the scan was stopped.');
      if (gone.aborted) return undefined;
      throw error;
    });
    res.locals = { ...res.locals, scanWork: work };
    return work;
  }
}
