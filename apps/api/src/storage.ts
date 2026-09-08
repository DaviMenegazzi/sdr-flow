import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FlowGraph } from '@sdr/shared';

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

export interface StoreData {
  flows: Record<string, StoredFlow>;
  activeBindings: Record<string, string>;
  settings: StoredSettings;
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
}

export const standaloneStore = new StandaloneStore();
