import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number; // e.g. 60000 (1 minute)
  maxRequests: number; // e.g. 120
  keyGenerator?: (req: Request, res: Response) => string;
}

interface ClientEntry {
  count: number;
  resetTime: number;
}

export class MemoryRateLimiter {
  private hits = new Map<string, ClientEntry>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private readonly defaultOptions: RateLimitOptions) {
    // Periodic garbage collection every 2 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 120_000);
    this.cleanupInterval.unref?.();
  }

  public middleware(customOptions?: Partial<RateLimitOptions>) {
    const opts = { ...this.defaultOptions, ...customOptions };

    return (req: Request, res: Response, next: NextFunction) => {
      const key = opts.keyGenerator
        ? opts.keyGenerator(req, res)
        : (res.locals?.organizationId as string) || req.ip || req.socket.remoteAddress || 'unknown';

      const now = Date.now();
      let entry = this.hits.get(key);

      if (!entry || now > entry.resetTime) {
        entry = { count: 1, resetTime: now + opts.windowMs };
        this.hits.set(key, entry);
      } else {
        entry.count++;
      }

      const remaining = Math.max(0, opts.maxRequests - entry.count);
      const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

      res.setHeader('X-RateLimit-Limit', opts.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

      if (entry.count > opts.maxRequests) {
        res.setHeader('Retry-After', resetSeconds);
        res.status(429).json({
          error: 'Limite de requisições excedido.',
          retryAfterSeconds: resetSeconds,
        });
        return;
      }

      next();
    };
  }

  public reset(key?: string) {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }

  public getCount(key: string): number {
    const entry = this.hits.get(key);
    if (!entry || Date.now() > entry.resetTime) return 0;
    return entry.count;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.hits.entries()) {
      if (now > entry.resetTime) {
        this.hits.delete(key);
      }
    }
  }

  public close() {
    clearInterval(this.cleanupInterval);
  }
}

export const orgRateLimiter = new MemoryRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120, // 120 req / min per organization
  keyGenerator: (req, res) => (res.locals?.organizationId as string) || req.ip || 'org_default',
});

export const publicRateLimiter = new MemoryRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60, // 60 req / min per IP for public endpoints
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'ip_default',
});
