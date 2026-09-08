import { logger } from './logger.js';

export interface SentryContext {
  organizationId?: string;
  flowId?: string;
  flowVersionId?: string;
  executionId?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export class SentryService {
  private static dsn = process.env.SENTRY_DSN || '';

  public static isConfigured(): boolean {
    return Boolean(this.dsn && this.dsn.startsWith('http'));
  }

  public static captureException(error: unknown, context: SentryContext = {}) {
    const errObj = error instanceof Error ? error : new Error(String(error));

    // Structured event payload
    const event = {
      timestamp: new Date().toISOString(),
      level: 'error',
      logger: 'sdr-flow:sentry',
      exception: {
        name: errObj.name,
        message: errObj.message,
        stack: errObj.stack,
      },
      tags: {
        organizationId: context.organizationId || 'unassigned',
        flowId: context.flowId || 'none',
        flowVersionId: context.flowVersionId || 'none',
        executionId: context.executionId || 'none',
        userId: context.userId || 'anonymous',
      },
      extra: context.extra || {},
    };

    if (this.isConfigured()) {
      // Production Sentry HTTP dispatch (non-blocking)
      fetch(this.dsn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch((e) => {
        logger.error({ err: e }, 'Failed to dispatch event to Sentry DSN');
      });
    }

    // Always log structured error event to Pino
    logger.error(
      {
        sentry: true,
        tags: event.tags,
        extra: event.extra,
        err: errObj,
      },
      `[SENTRY] ${errObj.name}: ${errObj.message}`
    );

    return event;
  }
}
