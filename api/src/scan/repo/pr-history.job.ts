import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';

// A background job for a private pull request history scan. The job lives in memory only, for a short time, and holds no token.
// A scan can take minutes, so the page starts it, then asks for its progress until it is done.
export const JOB_TTL_MS = 30 * 60 * 1000;
export const MAX_RUNNING_JOBS = 3;

type JobState = 'running' | 'done' | 'failed' | 'cancelled';

interface Job<T> {
  id: string;
  owner: string;
  tokenKey: string;
  state: JobState;
  done: number;
  total: number;
  // Which part runs: reading messages or pull requests, or the AI check at the end.
  step: 'read' | 'ai';
  result?: T;
  error?: string;
  at: number;
  // Stops the scan on the server when the visitor presses Cancel.
  controller: AbortController;
}

@Injectable()
export class PrHistoryJobs {
  private readonly jobs = new Map<string, Job<unknown>>();

  // Starts the work and returns at once. The work reports progress through the callback it is given.
  // The token is kept only as a hash, so one token cannot run two scans, even from different addresses.
  start<T>(owner: string, token: string, work: (progress: (done: number, total: number, step?: 'read' | 'ai') => void, signal: AbortSignal) => Promise<T>): Job<T> {
    this.sweep();
    const tokenKey = createHash('sha256').update(token).digest('hex');
    if (this.running((job) => job.tokenKey === tokenKey) > 0) {
      throw new HttpException('This token already has a scan running. Wait for it to finish.', HttpStatus.TOO_MANY_REQUESTS);
    }
    // One running scan per visitor, so one visitor cannot take every slot.
    if (this.running((job) => job.owner === owner) > 0) {
      throw new HttpException('You already have a scan running. Wait for it to finish, or stop it first.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (this.running() >= MAX_RUNNING_JOBS) {
      throw new HttpException('KinBeat is busy with other private scans. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const controller = new AbortController();
    const job: Job<T> = { id: randomUUID(), owner, tokenKey, state: 'running', done: 0, total: 0, step: 'read', at: Date.now(), controller };
    this.jobs.set(job.id, job as Job<unknown>);
    work((done, total, step) => {
      job.done = done;
      job.total = total;
      if (step) job.step = step;
    }, controller.signal).then(
      (result) => {
        job.state = 'done';
        job.result = result;
        job.at = Date.now();
      },
      (error: Error) => {
        job.state = controller.signal.aborted ? 'cancelled' : 'failed';
        // Only a message we wrote is shown. Any other error gets a fixed sentence, so no internal text reaches the page.
        job.error = error instanceof HttpException ? error.message : 'The scan stopped unexpectedly. Try again.';
        job.at = Date.now();
      },
    );
    return job;
  }

  // Stops a running job. Only the visitor who started it can stop it. The scan ends at its next step.
  cancel(id: string, owner: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner || job.state !== 'running') return false;
    job.controller.abort();
    return true;
  }

  // Only the visitor who started a job can read it. Any other answer is "not found", so ids cannot be guessed across visitors.
  get<T>(id: string, owner: string): Job<T> | undefined {
    this.sweep();
    const job = this.jobs.get(id) as Job<T> | undefined;
    return job && job.owner === owner ? job : undefined;
  }

  // Running jobs, all of them or only those that match.
  private running(match: (job: Job<unknown>) => boolean = () => true): number {
    let count = 0;
    for (const job of this.jobs.values()) if (job.state === 'running' && match(job)) count++;
    return count;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) if (now - job.at > JOB_TTL_MS) this.jobs.delete(id);
  }
}
