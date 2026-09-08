import type { Database } from './database.types.js';
import type { AnyDbClient } from './execution-repository.js';
import { encryptCredentials, decryptCredentials, maskSecret } from './crypto.js';

export type ConnectionProvider = Database['public']['Enums']['connection_provider'];
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface EvolutionCredentials {
  serverUrl: string;
  apiKey: string;
  instanceName?: string;
  webhookToken?: string;
}

export interface MetaCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret?: string;
  verifyToken?: string;
}

export type ConnectionCredentials = EvolutionCredentials | MetaCredentials;

export interface ConnectionEntity {
  id: string;
  organization_id: string;
  name: string;
  provider: ConnectionProvider;
  status: ConnectionStatus;
  phone: string | null;
  provider_instance_id: string | null;
  created_at: string;
  updated_at: string;
  webhook_url?: string;
}

export interface CreateConnectionInput {
  name: string;
  provider: ConnectionProvider;
  phone?: string | null;
  provider_instance_id?: string | null;
  credentials?: ConnectionCredentials;
  status?: ConnectionStatus;
}

export interface UpdateConnectionInput {
  name?: string;
  phone?: string | null;
  provider_instance_id?: string | null;
  status?: ConnectionStatus;
  credentials?: ConnectionCredentials;
}

export class ConnectionRepository {
  constructor(private readonly db: AnyDbClient) {}

  async resolveMessagingConnection(organizationId: string, connectionId: string) {
    const connection = await this.getConnection(organizationId, connectionId);
    if (!connection) return null;
    const credentials = await this.getConnectionCredentials(connectionId);
    return { provider: connection.provider, status: connection.status,
      credentials: credentials && connection.provider === 'evolution'
        ? { ...credentials, instanceName: connection.provider_instance_id || (credentials as EvolutionCredentials).instanceName }
        : credentials };
  }

  async listConnections(organizationId: string): Promise<ConnectionEntity[]> {
    const { data, error } = await this.db
      .from('connections')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((conn: any) => ({
      ...conn,
      status: conn.status as ConnectionStatus,
      webhook_url: `/api/webhooks/${conn.provider}/${conn.id}`,
    }));
  }

  async getConnection(organizationId: string, connectionId: string): Promise<ConnectionEntity | null> {
    const { data, error } = await this.db
      .from('connections')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', connectionId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      ...(data as any),
      status: data.status as ConnectionStatus,
      webhook_url: `/api/webhooks/${data.provider}/${data.id}`,
    };
  }

  async createConnection(
    organizationId: string,
    input: CreateConnectionInput,
    adminDb?: AnyDbClient
  ): Promise<ConnectionEntity> {
    const client = adminDb || this.db;

    const { data: conn, error: connErr } = await client
      .from('connections')
      .insert({
        organization_id: organizationId,
        name: input.name.trim(),
        provider: input.provider,
        status: input.status || 'disconnected',
        phone: input.phone || null,
        provider_instance_id: input.provider_instance_id || null,
      })
      .select()
      .single();

    if (connErr) throw connErr;

    if (input.credentials) {
      const ciphertext = encryptCredentials(input.credentials as unknown as Record<string, unknown>);
      const { error: credErr } = await client.rpc('set_connection_credentials', { p_org: organizationId, p_connection: conn.id, p_ciphertext: ciphertext });

      if (credErr) {
        // Rollback connection if credentials store fails
        await client.from('connections').delete().eq('id', conn.id);
        throw credErr;
      }
    }

    return {
      ...(conn as any),
      status: conn.status as ConnectionStatus,
      webhook_url: `/api/webhooks/${conn.provider}/${conn.id}`,
    };
  }

  async updateConnection(
    organizationId: string,
    connectionId: string,
    input: UpdateConnectionInput,
    adminDb?: AnyDbClient
  ): Promise<ConnectionEntity> {
    const client = adminDb || this.db;
    const patch: any = {
      updated_at: new Date().toISOString(),
    };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.status !== undefined) patch.status = input.status;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.provider_instance_id !== undefined) patch.provider_instance_id = input.provider_instance_id;

    const { data: conn, error: connErr } = await client
      .from('connections')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('id', connectionId)
      .select()
      .single();

    if (connErr) throw connErr;

    if (input.credentials) {
      const ciphertext = encryptCredentials(input.credentials as unknown as Record<string, unknown>);
      const { error: credErr } = await client.rpc('set_connection_credentials', { p_org: organizationId, p_connection: connectionId, p_ciphertext: ciphertext });

      if (credErr) throw credErr;
    }

    return {
      ...(conn as any),
      status: conn.status as ConnectionStatus,
      webhook_url: `/api/webhooks/${conn.provider}/${conn.id}`,
    };
  }

  async deleteConnection(organizationId: string, connectionId: string, adminDb?: AnyDbClient): Promise<{ ok: boolean }> {
    const client = adminDb || this.db;
    const { error } = await client
      .from('connections')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', connectionId);

    if (error) throw error;
    return { ok: true };
  }

  async getConnectionCredentials<T = ConnectionCredentials>(
    connectionId: string,
    adminDb?: AnyDbClient
  ): Promise<T | null> {
    const client = adminDb || this.db;
    const { data, error } = await client.rpc('get_connection_credentials', { p_connection: connectionId });

    if (error || !data) return null;

    try {
      return decryptCredentials<T>(data);
    } catch {
      return null;
    }
  }

  async updateStatus(
    connectionId: string,
    status: ConnectionStatus,
    phone?: string | null,
    adminDb?: AnyDbClient
  ): Promise<void> {
    const client = adminDb || this.db;
    const patch: any = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (phone) patch.phone = phone;

    await client
      .from('connections')
      .update(patch)
      .eq('id', connectionId);
  }
}
