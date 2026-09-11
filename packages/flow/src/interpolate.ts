import type { FlowContext } from '@sdr/shared';

function resolveField(obj: any, key: string): unknown {
  if (obj == null) return undefined;

  // Exact property lookup
  if (key in obj && obj[key] !== undefined) {
    return obj[key];
  }

  // Alias lookup for Brazilian SDR terms
  const aliases: Record<string, string[]> = {
    nome: ['name'],
    name: ['nome'],
    telefone: ['phone'],
    phone: ['telefone'],
    cidade: ['city'],
    city: ['cidade'],
    interesse: ['interest'],
    interest: ['interesse'],
    urgencia: ['urgency'],
    urgency: ['urgencia'],
    resumo: ['summary'],
    summary: ['resumo'],
  };

  if (aliases[key]) {
    for (const alias of aliases[key]) {
      if (alias in obj && obj[alias] !== undefined) {
        return obj[alias];
      }
    }
  }

  return undefined;
}

function resolvePath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = resolveField(current, part);
  }
  return current;
}

export function resolveValue(path: string, ctx: FlowContext | Record<string, unknown>): unknown {
  let resolved: unknown = undefined;

  // 1. Try variables first
  if ('variables' in ctx && ctx.variables && typeof ctx.variables === 'object') {
    resolved = resolvePath(ctx.variables, path);
  }

  // 2. Try root context
  if (resolved === undefined) {
    resolved = resolvePath(ctx, path);
  }

  // 3. Fallback for common context aliases
  if (resolved === undefined) {
    if (path === 'context.knowledge' || path === 'knowledge') {
      resolved = resolvePath(ctx, 'variables.knowledgeSnippets') || resolvePath(ctx, 'variables.knowledge');
    } else if (path === 'conversation.summary' || path === 'resumo') {
      resolved = resolvePath(ctx, 'variables.summary');
    }
  }

  return resolved;
}

export function interpolate(template: string, ctx: FlowContext | Record<string, unknown>): string {
  if (!template || typeof template !== 'string') return '';

  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path) => {
    const resolved = resolveValue(path, ctx);

    if (resolved === undefined || resolved === null) {
      return '';
    }

    if (Array.isArray(resolved)) {
      return resolved.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join('\n');
    }

    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }

    return String(resolved);
  });
}
