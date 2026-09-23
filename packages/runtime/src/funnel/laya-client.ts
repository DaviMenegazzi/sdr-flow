// Client for the shared Laya service (services/laya-classifier in the Tráfego Pro repo), which
// runs on this same VPS behind 127.0.0.1:8010. It serves one inference at a time for both
// projects, so callers must stay off the reply path and tolerate slow or failed answers.

export interface LayaConfig {
  url: string;
  secret: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type LayaQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } };

export interface LayaAnswer {
  type: 'choice' | 'score' | 'noul';
  choice?: string;
  score?: number;
  noul?: number;
  confidence: number;
}

function isAnswer(value: unknown): value is LayaAnswer {
  const answer = value as LayaAnswer | null;
  if (!answer || typeof answer !== 'object') return false;
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) return false;
  if (answer.type === 'choice') return typeof answer.choice === 'string';
  if (answer.type === 'score') return Number.isFinite(answer.score);
  return answer.type === 'noul' && Number.isFinite(answer.noul);
}

export function layaConfigFromEnv(env: NodeJS.ProcessEnv): LayaConfig | null {
  const url = env.LAYA_SERVICE_URL?.trim();
  const secret = env.LAYA_SERVICE_SECRET?.trim();
  if (!url || !secret) return null;
  return { url, secret, timeoutMs: Number(env.LAYA_TIMEOUT_MS) || 45_000 };
}

/** Laya truncates a list state from the left, so the newest turns survive a long conversation. */
export async function layaPredict(
  config: LayaConfig,
  state: string[],
  questions: Record<string, LayaQuestion>,
): Promise<Record<string, LayaAnswer>> {
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(`${config.url.replace(/\/$/, '')}/predict`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs ?? 45_000),
      headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, questions }),
    });
  } catch {
    throw new Error('Laya indisponível ou tempo limite excedido.');
  }
  if (!response.ok) throw new Error(`Laya: HTTP ${response.status}.`);
  const body = await response.json().catch(() => null) as { answers?: Record<string, unknown> } | null;
  const answers: Record<string, LayaAnswer> = {};
  for (const id of Object.keys(questions)) {
    const answer = body?.answers?.[id];
    if (!isAnswer(answer) || answer.type !== questions[id]!.type) throw new Error(`Laya retornou uma resposta inválida para ${id}.`);
    answers[id] = answer;
  }
  return answers;
}
