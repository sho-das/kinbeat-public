import { NestExpressApplication } from '@nestjs/platform-express';
import { trackUsage } from './scan/usage';
import { finishTrace, startTrace } from './scan/trace';

const JSON_LIMIT = '1mb';

export function configureApp(app: NestExpressApplication) {
  // Each request gets its own counter for the model tokens it uses.
  app.use((_req: unknown, _res: unknown, next: () => void) => trackUsage(next));
  // Each request also gets a trace. It is sent only if the request called the model, and it holds no text (see trace.ts).
  app.use((req: { path?: string }, res: { once(event: string, done: () => void): void }, next: () => void) =>
    startTrace(req.path ?? '', (trace) => {
      res.once('close', () => void finishTrace(trace));
      next();
    }),
  );
  app.useBodyParser('json', { limit: JSON_LIMIT });
  app.set('trust proxy', trustedHops());
}

// How many proxies in front of the web app add the visitor's address to X-Forwarded-For (a host, platform, CDN or nginx).
// The web app's own /api proxy adds nothing, it passes the header on. So the live site needs one such proxy in front, and the
// default 1 fits a single one. With a CDN and a load balancer, set TRUST_PROXY=2. With none (local development), a visitor
// can send any X-Forwarded-For, so the per-visitor limits can be dodged. Never expose the web app or the API without a proxy.
export function trustedHops(): number {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  return /^[0-5]$/.test(raw) ? Number(raw) : 1;
}
