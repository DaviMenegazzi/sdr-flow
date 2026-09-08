import crypto from 'node:crypto';
import type { ConnectionCredentials, EvolutionCredentials, MetaCredentials, ConnectionStatus } from '@sdr/db';
import { EvolutionClient, type EvolutionQrResponse } from './evolution-client.js';
import { MetaCloudClient, type MetaVerificationResult } from './meta-client.js';

export class ConnectionManager {
  /**
   * Valida credenciais e prepara metadados de conexão antes de persistir no banco.
   */
  static async prepareConnection(
    organizationId: string,
    name: string,
    provider: 'evolution' | 'meta',
    credentials: ConnectionCredentials,
    phone?: string | null
  ): Promise<{
    status: ConnectionStatus;
    phone: string | null;
    providerInstanceId: string;
    preparedCredentials: ConnectionCredentials;
    metaInfo?: MetaVerificationResult;
  }> {
    if (provider === 'meta') {
      const meta = credentials as MetaCredentials;
      if (!meta.phoneNumberId || !meta.accessToken || !meta.wabaId) {
        throw new Error('phoneNumberId, wabaId e accessToken são obrigatórios para a Meta Cloud API.');
      }

      const verification = await MetaCloudClient.verifyCredentials(meta.phoneNumberId, meta.accessToken);
      if (!verification.valid) {
        throw new Error(verification.error || 'Credenciais da Meta Cloud API inválidas.');
      }

      return {
        status: 'connected',
        phone: verification.displayPhoneNumber || phone || null,
        providerInstanceId: meta.phoneNumberId,
        preparedCredentials: {
          ...meta,
          verifyToken: meta.verifyToken || `sdr_meta_${crypto.randomBytes(12).toString('hex')}`,
        },
        metaInfo: verification,
      };
    }

    if (provider === 'evolution') {
      const evo = credentials as EvolutionCredentials;
      if (!evo.serverUrl || !evo.apiKey) {
        throw new Error('serverUrl e apiKey são obrigatórios para a Evolution API.');
      }

      const instanceName = evo.instanceName || `sdr_${organizationId.slice(0, 8)}_${crypto.randomBytes(4).toString('hex')}`;
      const client = new EvolutionClient(evo.serverUrl, evo.apiKey);

      if (!evo.instanceName) await client.createInstance(instanceName, phone || null);
      else {
        const state = await client.getConnectionState(instanceName);
        if (state.error) throw new Error('Não foi possível acessar a instância Evolution informada.');
      }

      return {
        status: 'connecting',
        phone: phone || null,
        providerInstanceId: instanceName,
        preparedCredentials: {
          ...evo,
          instanceName,
          webhookToken: evo.webhookToken || crypto.randomBytes(32).toString('hex'),
        },
      };
    }

    throw new Error(`Provedor desconhecido: ${provider}`);
  }

  /**
   * Obtém QR code ao vivo para conexão Evolution.
   */
  static async getLiveQr(
    instanceName: string,
    serverUrl: string,
    apiKey: string
  ): Promise<EvolutionQrResponse & { connected?: boolean }> {
    const client = new EvolutionClient(serverUrl, apiKey);
    const state = await client.getConnectionState(instanceName);

    if (state.state === 'open') {
      return {
        status: 'connected',
        connected: true,
      };
    }

    const qr = await client.getConnectQr(instanceName);
    return {
      ...qr,
      status: state.state === 'connecting' ? 'connecting' : 'disconnected',
      connected: false,
    };
  }

  /**
   * Verifica a saúde e status de conectividade em tempo real.
   */
  static async checkHealth(
    provider: 'evolution' | 'meta',
    providerInstanceId: string,
    credentials: ConnectionCredentials
  ): Promise<{ status: ConnectionStatus; error?: string }> {
    if (provider === 'meta') {
      const meta = credentials as MetaCredentials;
      const res = await MetaCloudClient.verifyCredentials(meta.phoneNumberId, meta.accessToken);
      return {
        status: res.valid ? 'connected' : 'error',
        error: res.error,
      };
    }

    if (provider === 'evolution') {
      const evo = credentials as EvolutionCredentials;
      const client = new EvolutionClient(evo.serverUrl, evo.apiKey);
      const res = await client.getConnectionState(providerInstanceId || evo.instanceName || '');
      if (res.state === 'open') return { status: 'connected' };
      if (res.state === 'connecting') return { status: 'connecting' };
      return { status: 'disconnected', error: res.error };
    }

    return { status: 'error', error: 'Provedor não suportado' };
  }
}
