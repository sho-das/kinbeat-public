import { positiveEnv } from '../scan/limits';
import { visitorKey } from './client-ip';
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    for (const [other, times] of this.hits) {
      const recent = times.filter((t) => now - t < this.windowMs);
      if (recent.length) this.hits.set(other, recent);
      else this.hits.delete(other);
    }
    const times = this.hits.get(key) ?? [];
    if (times.length >= this.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((times[0] + this.windowMs - now) / 1000)) };
    }
    times.push(now);
    this.hits.set(key, times);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  size(): number {
    return this.hits.size;
  }
}

@Injectable()
export class ScanRateLimitGuard implements CanActivate {
  private readonly limiter = new RateLimiter(positiveEnv('SCAN_RATE_LIMIT', 30), positiveEnv('SCAN_RATE_WINDOW_SECONDS', 600) * 1000);

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const result = this.limiter.hit(visitorKey(request));
    if (!result.allowed) {
      http.getResponse().setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(`Too many scans. Try again in ${result.retryAfterSeconds} seconds.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

// One file scan at a time for each visitor. It runs before the upload is read, so a second upload never reaches memory.
// The slot is freed once the response has ended AND the scan work has stopped. A visitor who leaves mid-scan therefore
// cannot start another scan while the first is still winding down. The controller records the work in res.locals.scanWork.
@Injectable()
export class OneFileScanGuard implements CanActivate {
  private readonly running = new Set<string>();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const key = visitorKey(http.getRequest());
    if (this.running.has(key)) {
      throw new HttpException('A file scan is already running. Try again when it finishes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.running.add(key);
    const response = http.getResponse();
    response.once('close', () => {
      const work: Promise<unknown> | undefined = response.locals?.scanWork;
      const free = () => this.running.delete(key);
      if (work) work.then(free, free);
      else free();
    });
    return true;
  }
}
