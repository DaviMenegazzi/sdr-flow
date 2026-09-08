import pino from 'pino';
import type { Request, Response, NextFunction } from 'express';

export const logger = pino({
  name: 'sdr-flow:api',
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export function createScopedLogger(context: {
  organizationId?: string;
  flowId?: string;
  flowVersionId?: string;
  executionId?: string;
  userId?: string;
}) {
  return logger.child(context);
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const path = req.path;

  // Don't clutter logs with periodic ping / health checks
  if (path === '/api/health') {
    next();
    return;
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const orgId = (res.locals?.organizationId as string) || (req.params?.organizationId as string) || undefined;
    const userId = (res.locals?.userId as string) || undefined;

    const logData = {
      method: req.method,
      path,
      statusCode: res.statusCode,
      durationMs: duration,
      organizationId: orgId,
      userId,
      ip: req.ip || req.socket.remoteAddress,
    };

    if (res.statusCode >= 500) {
      logger.error(logData, `HTTP ${req.method} ${path} failed with status ${res.statusCode}`);
    } else if (res.statusCode >= 400) {
      logger.warn(logData, `HTTP ${req.method} ${path} responded with client error ${res.statusCode}`);
    } else {
      logger.info(logData, `HTTP ${req.method} ${path} completed in ${duration}ms`);
    }
  });

  next();
}
