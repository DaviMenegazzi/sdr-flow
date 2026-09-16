import type { Database } from './database.types.js';
import type { AnyDbClient } from './execution-repository.js';
import { encryptCredentials, decryptCredentials } from './crypto.js';

export type CalendarAccountStatus = 'connected' | 'expired' | 'revoked' | 'error';

export interface CalendarAccountEntity {
  id: string;
  organization_id: string;
  provider: 'google_calendar';
  account_email: string;
  account_name: string | null;
  status: CalendarAccountStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SaveCalendarAccountInput {
  email: string;
  name?: string | null;
  status?: CalendarAccountStatus;
  credentials?: Record<string, unknown>;
}

export class CalendarRepository {
  constructor(private readonly db: AnyDbClient) {}

  async listAccounts(organizationId: string): Promise<CalendarAccountEntity[]> {
    const { data, error } = await this.db
      .from('calendar_accounts')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as CalendarAccountEntity[];
  }

  async getAccount(organizationId: string, accountId: string): Promise<CalendarAccountEntity | null> {
    const { data, error } = await this.db
      .from('calendar_accounts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', accountId)
      .maybeSingle();

    if (error || !data) return null;
    return data as CalendarAccountEntity;
  }

  async saveAccount(
    organizationId: string,
    userId: string,
    input: SaveCalendarAccountInput,
    adminDb?: AnyDbClient,
  ): Promise<CalendarAccountEntity> {
    const client = adminDb || this.db;

    const { data: account, error: accountErr } = await client
      .from('calendar_accounts')
      .upsert(
        {
          organization_id: organizationId,
          provider: 'google_calendar',
          account_email: input.email.toLowerCase().trim(),
          account_name: input.name?.trim() || null,
          status: input.status || 'connected',
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,provider,account_email' },
      )
      .select()
      .single();

    if (accountErr || !account) throw accountErr || new Error('Falha ao salvar conta de calendário.');

    if (input.credentials) {
      const ciphertext = encryptCredentials(input.credentials);
      const { error: credErr } = await client.rpc('set_calendar_credentials', {
        p_org: organizationId,
        p_account: account.id,
        p_ciphertext: ciphertext,
      });
      if (credErr) throw credErr;
    }

    return account as CalendarAccountEntity;
  }

  async getAccountCredentials<T = Record<string, unknown>>(
    accountId: string,
    adminDb?: AnyDbClient,
  ): Promise<T | null> {
    const client = adminDb || this.db;
    const { data, error } = await client.rpc('get_calendar_credentials', { p_account: accountId });
    if (error || !data) return null;

    try {
      return decryptCredentials<T>(data);
    } catch {
      return null;
    }
  }

  async deleteAccount(
    organizationId: string,
    accountId: string,
    adminDb?: AnyDbClient,
  ): Promise<{ ok: boolean }> {
    const client = adminDb || this.db;
    const { error } = await client
      .from('calendar_accounts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', accountId);

    if (error) throw error;
    return { ok: true };
  }

  async createOAuthState(
    organizationId: string,
    userId: string,
    state: string,
    provider = 'google_calendar',
    redirectUrl?: string | null,
    adminDb?: AnyDbClient,
  ): Promise<void> {
    const client = adminDb || this.db;
    const { error } = await client.rpc('create_oauth_state', {
      p_org: organizationId,
      p_user: userId,
      p_state: state,
      p_provider: provider,
      p_redirect_url: redirectUrl || null,
    });
    if (error) throw error;
  }

  async verifyAndConsumeOAuthState(
    state: string,
    adminDb?: AnyDbClient,
  ): Promise<{ organization_id: string; user_id: string; provider: string; redirect_url: string | null } | null> {
    const client = adminDb || this.db;
    const { data, error } = await client.rpc('verify_and_consume_oauth_state', { p_state: state });
    if (error || !data || !data.length || !data[0]) return null;
    return data[0];
  }

  async resolveActiveAccountCredentials<T = Record<string, unknown>>(
    organizationId: string,
    adminDb?: AnyDbClient,
  ): Promise<T | null> {
    const client = adminDb || this.db;
    const { data, error } = await client
      .from('calendar_accounts')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('status', 'connected')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return this.getAccountCredentials<T>(data.id, client);
  }
}
