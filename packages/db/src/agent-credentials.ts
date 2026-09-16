import type { AnyDbClient } from './execution-repository.js';
import { encryptCredentials, decryptCredentials } from './crypto.js';

/**
 * Every agent authenticates to OpenAI with its own key — never a platform-wide shared one,
 * and never readable through any path but this one (private.agent_credentials, reached only
 * via service_role-only RPCs; see supabase/migrations/202609161001_agent_openai_credentials.sql).
 * Mirrors ConnectionRepository's credential handling exactly.
 */

export async function setAgentOpenAIKey(
  db: AnyDbClient,
  organizationId: string,
  ownerUserId: string,
  agentId: string,
  apiKey: string
): Promise<void> {
  const ciphertext = encryptCredentials({ apiKey });
  const { error } = await (db as any).rpc('set_agent_openai_key', {
    p_org: organizationId,
    p_owner: ownerUserId,
    p_agent: agentId,
    p_ciphertext: ciphertext,
  });
  if (error) throw error;
}

export async function getAgentOpenAIKey(db: AnyDbClient, agentId: string): Promise<string | null> {
  const { data, error } = await (db as any).rpc('get_agent_openai_key', { p_agent: agentId });
  if (error || !data) return null;
  try {
    return decryptCredentials<{ apiKey: string }>(data).apiKey;
  } catch {
    return null;
  }
}

export async function agentHasOpenAIKey(db: AnyDbClient, agentId: string): Promise<boolean> {
  const { data, error } = await (db as any).rpc('agent_has_openai_key', { p_agent: agentId });
  if (error) return false;
  return Boolean(data);
}
