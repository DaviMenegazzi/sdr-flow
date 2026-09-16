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

  // Supabase/PostgREST errors (e.g. from a failed `.select()`/`.rpc()` call) are plain objects
  // shaped like { message, code, details, hint } — never `instanceof Error` — so the naive
  // `new Error(String(error))` fallback below used to stringify them as the literal,
  // undiagnosable text "[object Object]", discarding the real message entirely.
  private static toError(error: unknown): Error {
    if (error instanceof Error) return error;
    if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
      const obj = error as { message: string; code?: string | number };
      const err = new Error(obj.message);
      if (obj.code !== undefined) err.name = `PostgrestError(${obj.code})`;
      return err;
    }
    return new Error(String(error));
  }

  private static extraFieldsFrom(error: unknown): Record<string, unknown> {
    if (!error || typeof error !== 'object' || error instanceof Error) return {};
    const { code, details, hint } = error as { code?: unknown; details?: unknown; hint?: unknown };
    const fields: Record<string, unknown> = {};
    if (code !== undefined) fields.code = code;
    if (details !== undefined) fields.details = details;
    if (hint !== undefined) fields.hint = hint;
    return fields;
  }

  public static captureException(error: unknown, context: SentryContext = {}) {
    const errObj = this.toError(error);

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
      extra: { ...this.extraFieldsFrom(error), ...context.extra },
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
