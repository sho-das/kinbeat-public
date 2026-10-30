import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AuditService } from '../auth/audit.service';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScanLog } from './scan.log';

const EVAL_DIR = join(process.cwd(), 'evals', 'results');
const FILE_NAME = /^[\w.-]+\.json$/;

@Controller('logs')
export class LogsController {
  constructor(
    private readonly scanLog: ScanLog,
    private readonly audit: AuditService,
  ) {}

  @Get('audit')
  auditLog(@Query('limit') limit?: string) {
    return this.audit.list(Number(limit) || 100);
  }

  @Get('scans')
  async scans() {
    return this.scanLog.list();
  }

  @Get('scans/:id')
  async scan(@Param('id') id: string) {
    const entry = await this.scanLog.get(id);
    if (!entry) throw new NotFoundException(`No scan with id ${id}`);
    return entry;
  }

  @Get('evals')
  evals() {
    return listRuns((name) => !name.startsWith('checks-'), (file, run) => ({ file, timestamp: run.timestamp, mode: run.mode, model: run.model, gitHash: run.gitHash, summary: run.summary, cases: run.cases.length }));
  }

  @Get('evals/:file')
  evalRun(@Param('file') file: string) {
    return readRun(file, (name) => !name.startsWith('checks-'), 'No such eval run');
  }

  @Get('checks')
  checks() {
    return listRuns((name) => name.startsWith('checks-'), (file, run) => ({ file, timestamp: run.timestamp, mode: run.mode, summary: run.summary }));
  }

  @Get('checks/:file')
  check(@Param('file') file: string) {
    return readRun(file, (name) => name.startsWith('checks-'), 'No such checks run');
  }
}

type Run = Record<string, any>;

// Result files from `npm run eval` and `npm run checks`, newest first. No folder or an unreadable file means no runs to show.
function listRuns(wanted: (name: string) => boolean, summarise: (file: string, run: Run) => Run): Run[] {
  let names: string[];
  try {
    names = readdirSync(EVAL_DIR).filter((name) => FILE_NAME.test(name) && wanted(name)).sort().reverse();
  } catch {
    return [];
  }
  return names.map((file) => summarise(file, JSON.parse(readFileSync(join(EVAL_DIR, file), 'utf8'))));
}

function readRun(file: string, wanted: (name: string) => boolean, missing: string): Run {
  if (!FILE_NAME.test(file) || !wanted(file)) throw new NotFoundException(missing);
  try {
    return JSON.parse(readFileSync(join(EVAL_DIR, file), 'utf8'));
  } catch {
    throw new NotFoundException(missing);
  }
}
