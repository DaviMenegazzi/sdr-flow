export interface MetaVerificationResult {
  valid: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  error?: string;
}

export class MetaCloudClient {
  static async verifyCredentials(
    phoneNumberId: string,
    accessToken: string
  ): Promise<MetaVerificationResult> {
    try {
      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,code_verification_status`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = (await res.json()) as any;
      if (!res.ok || data.error) {
        return {
          valid: false,
          error: data.error?.message || `HTTP ${res.status}: Credenciais da Meta inválidas`,
        };
      }

      return {
        valid: true,
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
      };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Falha na conexão com a Graph API da Meta',
      };
    }
  }

  static async sendTextMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    text: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const digits = to.replace(/\D/g, '');
      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: digits,
          type: 'text',
          text: { body: text },
        }),
      });

      const data = (await res.json()) as any;
      if (!res.ok || data.error) {
        return {
          success: false,
          error: data.error?.message || `Falha no envio Meta (${res.status})`,
        };
      }

      const messageId = data.messages?.[0]?.id;
      return { success: true, messageId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao enviar mensagem Meta',
      };
    }
  }
}
