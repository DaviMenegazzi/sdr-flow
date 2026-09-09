interface ExportableDebugSession {
  id: string;
  status: string;
  armedAt: string;
  expiresAt: string;
  startedAt?: string;
  finishedAt?: string;
  executionId?: string;
  report?: unknown;
}

interface TimestampedMessage {
  created_at: string;
}

export function buildAgentDebugExport<
  TSession extends ExportableDebugSession,
  TConversation,
  TMessage extends TimestampedMessage,
  TStep,
>(input: {
  session: TSession;
  conversation: TConversation;
  messages: TMessage[];
  steps: TStep[];
  exportedAt?: string;
}) {
  const exportedAt = input.exportedAt || new Date().toISOString();
  const windowStart = Date.parse(input.session.armedAt);
  const windowEnd = Date.parse(input.session.finishedAt || exportedAt);
  const messagesDuringListening = input.messages.filter(message => {
    const timestamp = Date.parse(message.created_at);
    return Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= windowEnd;
  });

  return {
    schemaVersion: 'sdr-flow.agent-debug.v1',
    exportedAt,
    scope: {
      mode: 'one-shot',
      includesPreviousMessages: false,
      listeningWindow: {
        armedAt: input.session.armedAt,
        startedAt: input.session.startedAt || null,
        finishedAt: input.session.finishedAt || exportedAt,
        expiresAt: input.session.expiresAt,
      },
      description: 'Captura da próxima execução do agente iniciada depois que a escuta foi ativada.',
    },
    sensitiveDataWarning: 'Este arquivo pode conter dados pessoais, memória comercial, prompts, entradas e saídas do agente.',
    identifiers: {
      debugSessionId: input.session.id,
      executionId: input.session.executionId || null,
      status: input.session.status,
    },
    conversationSnapshot: input.conversation,
    messagesDuringListening,
    debugSession: input.session,
    normalizedExecution: {
      steps: input.steps,
      report: input.session.report || null,
    },
  };
}

export function createAgentDebugFilename(input: {
  conversationLabel?: string | null;
  sessionId: string;
  executionId?: string;
  exportedAt?: string;
}) {
  const exportedAt = input.exportedAt || new Date().toISOString();
  const label = (input.conversationLabel || 'conversa')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'conversa';
  const timestamp = exportedAt.replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-');
  const execution = (input.executionId || input.sessionId).slice(0, 8);
  return `sdr-debug-${label}-${timestamp}-${execution}.json`;
}
