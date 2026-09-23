import { ConnectionRepository } from '@sdr/db';
import type { ServiceDb } from '../inbound/inbound-event-repository.js';

// Resolves a WhatsApp group's real title from Evolution (plan item 2: the webhook payload does
// not always carry the group subject, only the participant's pushName). Deliberately reimplements
// the same HTTP call as apps/api/src/whatsapp/evolution-client.ts's fetchGroups instead of
// importing it: packages/runtime is a dependency of apps/api (see webhook.ts), so importing back
// from apps/api here would be circular. packages/flow/src/server/messaging.ts already
// establishes this same "re-implement the Evolution call locally" pattern for the same reason.
//
// Called by turn-processor only when a message's own payload had no group name AND the lead has
// no group_subject persisted yet — every later message for the same group reuses the persisted
// name, so this hits the network only once per group in the common case. The in-memory cache
// below only guards against a burst of first-contact messages for the same brand-new group
// arriving as separate turns before the first resolution is persisted.

interface EvolutionGroupsCacheEntry {
  timestamp: number;
  groups: Array<{ id: string; subject: string }>;
}

const groupsByConnectionCache = new Map<string, EvolutionGroupsCacheEntry>();
const CACHE_TTL_MS = 60_000;

async function requestJson(url: string, headers: Record<string, string>, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllGroupsFromEvolution(
  serverUrl: string,
  apiKey: string,
  instanceName: string
): Promise<Array<{ id: string; subject: string }>> {
  const base = serverUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', apikey: apiKey };
  const data = await requestJson(`${base}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`, headers)
    .catch(() => requestJson(`${base}/group/fetchAllGroups/${encodeURIComponent(instanceName)}`, headers));

  let list: any[] = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    if (Array.isArray(data.response)) list = data.response;
    else if (Array.isArray(data.data)) list = data.data;
    else if (Array.isArray(data.groups)) list = data.groups;
    else if (Array.isArray(data.chats)) list = data.chats;
  }

  return list
    .map((g: any) => ({ id: String(g.id || g.jid || ''), subject: String(g.subject || g.name || g.formattedTitle || '') }))
    .filter(g => Boolean(g.id));
}

async function groupsForConnection(
  db: ServiceDb,
  organizationId: string,
  connectionId: string
): Promise<Array<{ id: string; subject: string }>> {
  const cached = groupsByConnectionCache.get(connectionId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.groups;

  const connection = await new ConnectionRepository(db).resolveMessagingConnection(organizationId, connectionId);
  if (!connection || connection.provider !== 'evolution') return [];
  const creds = connection.credentials as { serverUrl?: string; apiKey?: string; instanceName?: string } | null;
  if (!creds?.serverUrl || !creds.apiKey || !creds.instanceName) return [];

  const groups = await fetchAllGroupsFromEvolution(creds.serverUrl, creds.apiKey, creds.instanceName);
  groupsByConnectionCache.set(connectionId, { timestamp: Date.now(), groups });
  return groups;
}

/**
 * Returns the group's real subject from Evolution's group catalog, or null when it can't be
 * resolved (no Evolution connection, missing credentials, network failure, or the group is
 * simply not in the catalog yet). Never throws — callers fall back to a placeholder that is
 * never the sending participant's name.
 */
export async function resolveGroupSubject(
  db: ServiceDb,
  organizationId: string,
  connectionId: string,
  groupJid: string
): Promise<string | null> {
  try {
    const groups = await groupsForConnection(db, organizationId, connectionId);
    const match = groups.find(g => g.id === groupJid);
    const subject = match?.subject?.trim();
    if (!subject) console.warn(`[group-subject-resolver] Grupo ${groupJid} sem nome no catálogo da Evolution (${groups.length} grupo(s) retornado(s)).`);
    return subject || null;
  } catch (err) {
    console.warn(`[group-subject-resolver] Falha ao buscar nome do grupo ${groupJid} na Evolution:`, err instanceof Error ? err.message : err);
    return null;
  }
}
