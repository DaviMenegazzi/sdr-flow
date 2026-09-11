import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FlowGraph } from '@sdr/shared';
import { KnowledgeRepository } from '@sdr/db';

export interface StoredFlow {
  id: string;
  name: string;
  graph: FlowGraph;
  targetInstance?: string | null;
  published: boolean;
  publishedVersion: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSettings {
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTimeoutMs?: number;
  evolutionServerUrl?: string;
  evolutionApiKey?: string;
  publicApiUrl?: string;
}

export interface StoredKnowledgeDoc {
  id: string;
  collection: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  token_count: number;
  created_at: string;
  updated_at: string;
}

export interface ExternalIntegration {
  id: string;
  provider: 'google_calendar' | 'hubspot' | 'rdstation' | 'kommo';
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  accountEmail?: string;
  credentials: {
    client_id?: string;
    client_secret?: string;
    refresh_token?: string;
    access_token?: string;
    expires_at?: number;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
  connectedAt?: string;
  updatedAt: string;
}

export interface StoreData {
  flows: Record<string, StoredFlow>;
  activeBindings: Record<string, string>;
  settings: StoredSettings;
  knowledge?: Record<string, StoredKnowledgeDoc>;
  integrations?: Record<string, ExternalIntegration>;
}

export class StandaloneStore {
  private filePath: string;
  private data: StoreData;

  constructor(filePath?: string) {
    const defaultDir = path.resolve(process.cwd(), 'data');
    this.filePath = filePath || path.join(defaultDir, 'store.json');
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          flows: parsed.flows || {},
          activeBindings: parsed.activeBindings || {},
          settings: parsed.settings || {},
          knowledge: parsed.knowledge || {},
          integrations: parsed.integrations || {},
        };
      }
    } catch {
      // Fallback
    }

    return {
      flows: {},
      activeBindings: {},
      settings: {
        openaiApiKey: process.env.OPENAI_API_KEY || '',
        openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        evolutionServerUrl: process.env.EVOLUTION_SERVER_URL || 'http://127.0.0.1:8080',
        evolutionApiKey: process.env.EVOLUTION_API_KEY || 'EvolutionApiSecretKey_2026',
        publicApiUrl: process.env.PUBLIC_API_URL || '',
      },
      knowledge: {},
    };
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[StandaloneStore] Erro ao persistir dados:', err);
    }
  }

  listFlows(): StoredFlow[] {
    return Object.values(this.data.flows).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getFlow(id: string): StoredFlow | null {
    return this.data.flows[id] || null;
  }

  saveFlow(params: {
    id?: string;
    name: string;
    graph: FlowGraph;
    targetInstance?: string | null;
  }): StoredFlow {
    const id = params.id && this.data.flows[params.id] ? params.id : crypto.randomUUID();
    const existing = this.data.flows[id];
    const now = new Date().toISOString();

    const flow: StoredFlow = {
      id,
      name: params.name.trim() || 'Novo Fluxo',
      graph: params.graph,
      targetInstance: params.targetInstance !== undefined ? params.targetInstance : (existing?.targetInstance ?? null),
      published: existing ? existing.published : false,
      publishedVersion: existing ? existing.publishedVersion : 0,
      publishedAt: existing ? existing.publishedAt : null,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.data.flows[id] = flow;
    this.persist();
    return flow;
  }

  publishFlow(
    id: string,
    graph: FlowGraph,
    targetInstance?: string | null
  ): { version: number; flow: StoredFlow } {
    let flow = this.data.flows[id];
    const now = new Date().toISOString();

    if (!flow) {
      flow = {
        id,
        name: 'Fluxo Publicado',
        graph,
        targetInstance: targetInstance || null,
        published: true,
        publishedVersion: 1,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      flow.graph = graph;
      flow.published = true;
      flow.publishedVersion = (flow.publishedVersion || 0) + 1;
      flow.publishedAt = now;
      flow.updatedAt = now;
      if (targetInstance !== undefined) {
        flow.targetInstance = targetInstance;
      }
    }

    this.data.flows[id] = flow;

    const assignedInstance = flow.targetInstance || targetInstance;
    if (assignedInstance) {
      this.data.activeBindings[assignedInstance] = id;
    }

    this.persist();
    return { version: flow.publishedVersion, flow };
  }

  deleteFlow(id: string): boolean {
    if (!this.data.flows[id]) return false;
    delete this.data.flows[id];

    for (const [instance, flowId] of Object.entries(this.data.activeBindings)) {
      if (flowId === id) {
        delete this.data.activeBindings[instance];
      }
    }

    this.persist();
    return true;
  }

  getActiveBindings(): Record<string, { flowId: string; flow: StoredFlow }> {
    const result: Record<string, { flowId: string; flow: StoredFlow }> = {};
    for (const [instance, flowId] of Object.entries(this.data.activeBindings)) {
      const flow = this.data.flows[flowId];
      if (flow) {
        result[instance] = { flowId, flow };
      }
    }
    return result;
  }

  getActiveFlowForInstance(instanceName: string): StoredFlow | null {
    const flowId = this.data.activeBindings[instanceName];
    if (!flowId) return null;
    return this.data.flows[flowId] || null;
  }

  bindInstance(instanceName: string, flowId: string): void {
    if (this.data.flows[flowId]) {
      this.data.activeBindings[instanceName] = flowId;
      this.data.flows[flowId].targetInstance = instanceName;
      this.data.flows[flowId].updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  unbindInstance(instanceName: string): void {
    delete this.data.activeBindings[instanceName];
    this.persist();
  }

  getSettings(): StoredSettings {
    return {
      openaiApiKey: this.data.settings.openaiApiKey || process.env.OPENAI_API_KEY || '',
      openaiModel: this.data.settings.openaiModel || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      openaiTimeoutMs: this.data.settings.openaiTimeoutMs || Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
      evolutionServerUrl: this.data.settings.evolutionServerUrl || process.env.EVOLUTION_SERVER_URL || 'http://127.0.0.1:8080',
      evolutionApiKey: this.data.settings.evolutionApiKey || process.env.EVOLUTION_API_KEY || 'EvolutionApiSecretKey_2026',
      publicApiUrl: this.data.settings.publicApiUrl || process.env.PUBLIC_API_URL || '',
    };
  }

  updateSettings(patch: Partial<StoredSettings>): StoredSettings {
    this.data.settings = {
      ...this.data.settings,
      ...patch,
    };
    if (patch.openaiApiKey) process.env.OPENAI_API_KEY = patch.openaiApiKey;
    if (patch.openaiModel) process.env.OPENAI_MODEL = patch.openaiModel;
    if (patch.evolutionServerUrl) process.env.EVOLUTION_SERVER_URL = patch.evolutionServerUrl;
    if (patch.evolutionApiKey) process.env.EVOLUTION_API_KEY = patch.evolutionApiKey;
    if (patch.publicApiUrl) process.env.PUBLIC_API_URL = patch.publicApiUrl;

    this.persist();
    return this.getSettings();
  }

  // --- KNOWLEDGE BASE ---
  listKnowledge(collection?: string): StoredKnowledgeDoc[] {
    const docs = Object.values(this.data.knowledge || {});
    const filtered = collection && collection !== 'all'
      ? docs.filter(d => d.collection.toLowerCase() === collection.toLowerCase())
      : docs;
    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  getKnowledge(id: string): StoredKnowledgeDoc | null {
    return this.data.knowledge?.[id] || null;
  }

  createKnowledge(params: {
    collection?: string;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): StoredKnowledgeDoc {
    if (!this.data.knowledge) this.data.knowledge = {};

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = params.title.trim();
    const content = params.content.trim();
    const collection = (params.collection || 'pricing').trim().toLowerCase();
    const token_count = Math.max(1, Math.ceil((title.length + content.length) / 4));
    const embedding = KnowledgeRepository.generateFallbackEmbedding(`${title} ${content}`);

    const doc: StoredKnowledgeDoc = {
      id,
      collection,
      title,
      content,
      metadata: params.metadata || {},
      embedding,
      token_count,
      created_at: now,
      updated_at: now,
    };

    this.data.knowledge[id] = doc;
    this.persist();
    return doc;
  }

  updateKnowledge(
    id: string,
    patch: {
      collection?: string;
      title?: string;
      content?: string;
      metadata?: Record<string, unknown>;
    }
  ): StoredKnowledgeDoc | null {
    if (!this.data.knowledge || !this.data.knowledge[id]) return null;

    const existing = this.data.knowledge[id];
    const title = patch.title !== undefined ? patch.title.trim() : existing.title;
    const content = patch.content !== undefined ? patch.content.trim() : existing.content;
    const collection = patch.collection !== undefined ? patch.collection.trim().toLowerCase() : existing.collection;
    const now = new Date().toISOString();

    let embedding = existing.embedding;
    if (patch.title !== undefined || patch.content !== undefined) {
      embedding = KnowledgeRepository.generateFallbackEmbedding(`${title} ${content}`);
    }
    const token_count = Math.max(1, Math.ceil((title.length + content.length) / 4));

    const updated: StoredKnowledgeDoc = {
      ...existing,
      collection,
      title,
      content,
      metadata: patch.metadata !== undefined ? patch.metadata : existing.metadata,
      embedding,
      token_count,
      updated_at: now,
    };

    this.data.knowledge[id] = updated;
    this.persist();
    return updated;
  }

  deleteKnowledge(id: string): boolean {
    if (!this.data.knowledge || !this.data.knowledge[id]) return false;
    delete this.data.knowledge[id];
    this.persist();
    return true;
  }

  listCollections(): Array<{ collection: string; count: number }> {
    const counts: Record<string, number> = {};
    for (const doc of Object.values(this.data.knowledge || {})) {
      counts[doc.collection] = (counts[doc.collection] || 0) + 1;
    }
    return Object.entries(counts).map(([collection, count]) => ({ collection, count }));
  }

  searchKnowledge(
    query: string,
    options?: { collection?: string; threshold?: number; limit?: number }
  ): Array<StoredKnowledgeDoc & { similarity: number }> {
    if (!this.data.knowledge) return [];
    const queryEmb = KnowledgeRepository.generateFallbackEmbedding(query);
    const candidates = Object.values(this.data.knowledge);
    const targetCol = options?.collection && options.collection !== 'all' ? options.collection.toLowerCase() : undefined;
    const threshold = typeof options?.threshold === 'number' ? options.threshold : 0.2;
    const limit = typeof options?.limit === 'number' ? options.limit : 5;

    const hits: Array<StoredKnowledgeDoc & { similarity: number }> = [];

    for (const doc of candidates) {
      if (targetCol && doc.collection.toLowerCase() !== targetCol) continue;
      let emb = doc.embedding;
      if (!emb || emb.length === 0) {
        emb = KnowledgeRepository.generateFallbackEmbedding(`${doc.title} ${doc.content}`);
      }
      const sim = KnowledgeRepository.cosineSimilarity(queryEmb, emb);
      if (sim >= threshold) {
        hits.push({ ...doc, similarity: Number(sim.toFixed(4)) });
      }
    }

    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, limit);
  }
  // --- EXTERNAL INTEGRATIONS ---
  listIntegrations(): ExternalIntegration[] {
    if (!this.data.integrations) return [];
    return Object.values(this.data.integrations);
  }

  getIntegration(id: string): ExternalIntegration | null {
    if (!this.data.integrations) return null;
    return this.data.integrations[id] || null;
  }

  getIntegrationByProvider(provider: string): ExternalIntegration | null {
    if (!this.data.integrations) return null;
    return Object.values(this.data.integrations).find(i => i.provider === provider && i.status === 'connected') || null;
  }

  saveIntegration(integration: ExternalIntegration): ExternalIntegration {
    if (!this.data.integrations) this.data.integrations = {};
    const existing = this.data.integrations[integration.id];
    const saved: ExternalIntegration = {
      ...existing,
      ...integration,
      updatedAt: new Date().toISOString(),
    };
    this.data.integrations[saved.id] = saved;
    this.persist();
    return saved;
  }

  deleteIntegration(id: string): boolean {
    if (!this.data.integrations || !this.data.integrations[id]) return false;
    delete this.data.integrations[id];
    this.persist();
    return true;
  }
}

export const standaloneStore = new StandaloneStore();
