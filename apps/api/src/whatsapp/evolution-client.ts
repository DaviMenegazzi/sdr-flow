export interface EvolutionQrResponse {
  code?: string;
  base64?: string;
  pairingCode?: string;
  count?: number;
  status?: string;
  error?: string;
}

export interface EvolutionStateResponse {
  state: 'open' | 'connecting' | 'close';
  error?: string;
}

export class EvolutionClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey.trim();
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.apiKey,
    };
  }

  private async request<T = any>(path: string, options: RequestInit = {}, timeoutMs = 15000): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...this.headers,
          ...(options.headers as Record<string, string> || {}),
        },
        signal: controller.signal,
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (res.ok) return data as T;

      throw new Error(
        typeof data === 'object' && data !== null
          ? data.response?.message || data.message || `HTTP ${res.status}`
          : text || `HTTP ${res.status}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async createInstance(instanceName: string, number?: string | null): Promise<any> {
    const payload: Record<string, any> = {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    };
    if (number) payload.number = number;

    return this.request('/instance/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 20000);
  }

  async fetchInstances(): Promise<any[]> {
    try {
      const data = await this.request<any[]>('/instance/fetchInstances', {
        method: 'GET',
      }, 10000);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getConnectQr(instanceName: string): Promise<EvolutionQrResponse> {
    try {
      const data = await this.request<any>(`/instance/connect/${encodeURIComponent(instanceName)}`, {
        method: 'GET',
      }, 15000);

      return {
        code: data?.code || data?.qrcode?.code,
        base64: data?.base64 || data?.qrcode?.base64,
        pairingCode: data?.pairingCode,
        count: data?.count,
      };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Falha ao obter QR code da Evolution API',
      };
    }
  }

  async getConnectionState(instanceName: string): Promise<EvolutionStateResponse> {
    try {
      const data = await this.request<any>(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
        method: 'GET',
      }, 10000);

      const state = data?.instance?.state || data?.state || 'close';
      return { state };
    } catch (err) {
      return {
        state: 'close',
        error: err instanceof Error ? err.message : 'Erro ao consultar status da instância',
      };
    }
  }

  async setWebhook(instanceName: string, webhookUrl: string, webhookToken?: string): Promise<any> {
    const payload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: webhookToken ? { 'x-webhook-token': webhookToken } : undefined,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'SEND_MESSAGE'],
      },
    };

    return this.request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 10000);
  }

  async restartInstance(instanceName: string): Promise<any> {
    return this.request(`/instance/restart/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
    }, 15000);
  }

  async deleteInstance(instanceName: string): Promise<any> {
    return this.request(`/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: 'DELETE',
    }, 15000);
  }

  async sendTextMessage(
    instanceName: string,
    to: string,
    text: string,
    delayMs = 1200
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    let targetJid = to;
    if (!targetJid.includes('@')) {
      const digits = targetJid.replace(/\D/g, '');
      targetJid = `${digits}@s.whatsapp.net`;
    }

    const payload = {
      number: targetJid,
      text,
      delay: delayMs,
      linkPreview: true,
    };

    try {
      const res = await this.request(`/message/sendText/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      return {
        success: true,
        messageId: res?.key?.id || res?.messageId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Falha no envio Evolution',
      };
    }
  }

  async fetchGroups(instanceName: string): Promise<Array<{ id: string; subject: string; size?: number }>> {
    try {
      let data: any = await this.request<any>(`/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`, {
        method: 'GET',
      }, 10000).catch(async () => {
        return this.request<any>(`/group/fetchAllGroups/${encodeURIComponent(instanceName)}`, {
          method: 'GET',
        }, 10000);
      });

      let list: any[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data.response)) list = data.response;
        else if (Array.isArray(data.data)) list = data.data;
        else if (Array.isArray(data.groups)) list = data.groups;
        else if (Array.isArray(data.chats)) list = data.chats;
      }

      return list.map((g: any) => ({
        id: g.id || g.jid || '',
        subject: g.subject || g.name || g.formattedTitle || g.id || 'Grupo sem nome',
        size: g.size || (Array.isArray(g.participants) ? g.participants.length : undefined),
      })).filter((g: any) => Boolean(g.id));
    } catch {
      return [];
    }
  }

  async fetchChats(instanceName: string): Promise<Array<{ id: string; name?: string; pushName?: string }>> {
    try {
      let data: any = await this.request<any>(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, 10000).catch(async () => {
        return this.request<any>(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
          method: 'GET',
        }, 10000);
      });

      let list: any[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data.response)) list = data.response;
        else if (Array.isArray(data.data)) list = data.data;
        else if (Array.isArray(data.chats)) list = data.chats;
      }

      return list.map((c: any) => ({
        id: c.id || c.remoteJid || c.jid || '',
        name: c.name || c.subject || c.pushName || c.formattedTitle || c.id || '',
        pushName: c.pushName,
      })).filter((c: any) => Boolean(c.id));
    } catch {
      return [];
    }
  }
}

