import {
  setAgentOpenAIKey,
  getAgentOpenAIKeyMeta,
  deleteAgentOpenAIKey,
  type AnyDbClient,
} from '@sdr/db';

/**
 * Automatic OpenAI key per agent (platform <-> Supabase <-> OpenAI): with the platform's
 * OpenAI Admin key we create one OpenAI project per agent and a service account inside it.
 * OpenAI returns the service account's key exactly once; it goes straight into
 * private.agent_credentials (encrypted) and is never shown to anyone. Until that write
 * succeeds the agent stays without a key and does not answer (missing_openai_key).
 */

const OPENAI_ADMIN_BASE = 'https://api.openai.com/v1/organization';

export class OpenAIAdminClient {
  constructor(private readonly adminKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${OPENAI_ADMIN_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.adminKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI Admin API ${method} ${path} → ${res.status} ${detail.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  createProject(name: string) {
    return this.request<{ id: string }>('POST', '/projects', { name });
  }

  createServiceAccount(projectId: string, name: string) {
    return this.request<{ id: string; api_key?: { value?: string } }>('POST', `/projects/${projectId}/service_accounts`, { name });
  }

  archiveProject(projectId: string) {
    return this.request<unknown>('POST', `/projects/${projectId}/archive`);
  }
}

export interface ProvisionAgent {
  id: string;
  organization_id: string;
  owner_user_id: string;
  name: string;
}

const inFlight = new Map<string, Promise<void>>();

async function setSyncStatus(db: AnyDbClient, agentId: string, status: 'pending' | 'synced' | 'failed', error: string | null) {
  await (db as any).from('ai_agents').update({ openai_sync_status: status, openai_sync_error: error }).eq('id', agentId);
}

/**
 * Creates the agent's OpenAI project + service account and stores the key. Never replaces an
 * existing key (own keys win, and a synced platform key stays). Concurrent calls for the same
 * agent share one run so a reload during sync can't create two projects.
 */
export function provisionAgentOpenAIKey(db: AnyDbClient, client: OpenAIAdminClient, agent: ProvisionAgent): Promise<void> {
  const running = inFlight.get(agent.id);
  if (running) return running;
  const run = (async () => {
    if (await getAgentOpenAIKeyMeta(db, agent.id)) {
      await setSyncStatus(db, agent.id, 'synced', null);
      return;
    }
    await setSyncStatus(db, agent.id, 'pending', null);
    let projectId: string | null = null;
    try {
      const project = await client.createProject(`SDR Flow · ${agent.name.slice(0, 60)} · ${agent.id.slice(0, 8)}`);
      projectId = project.id;
      const account = await client.createServiceAccount(project.id, `sdr-flow-agent-${agent.id}`);
      const apiKey = account.api_key?.value;
      if (!apiKey) throw new Error('OpenAI não devolveu a chave do service account.');
      await setAgentOpenAIKey(db, agent.organization_id, agent.owner_user_id, agent.id, apiKey, {
        source: 'platform',
        openaiProjectId: project.id,
        openaiServiceAccountId: account.id,
      });
    } catch (err) {
      // Don't leave an orphan project with a live key nobody stored.
      if (projectId) await client.archiveProject(projectId).catch(() => undefined);
      await setSyncStatus(db, agent.id, 'failed', err instanceof Error ? err.message.slice(0, 500) : 'Falha desconhecida');
      throw err;
    }
  })().finally(() => inFlight.delete(agent.id));
  inFlight.set(agent.id, run);
  return run;
}

/** Removes the agent's key; platform keys also get their OpenAI project archived (revokes the key). */
export async function revokeAgentOpenAIKey(db: AnyDbClient, client: OpenAIAdminClient | null, agentId: string): Promise<void> {
  const meta = await getAgentOpenAIKeyMeta(db, agentId);
  if (!meta) return;
  if (meta.source === 'platform' && meta.openaiProjectId) {
    if (!client) throw new Error('OPENAI_ADMIN_KEY ausente: não é possível revogar a chave da plataforma.');
    await client.archiveProject(meta.openaiProjectId);
  }
  await deleteAgentOpenAIKey(db, agentId);
}
