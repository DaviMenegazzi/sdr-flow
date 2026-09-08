import crypto from 'node:crypto';
import type { Database, Json } from './database.types.js';
import type { AnyDbClient } from './execution-repository.js';
import type { MemberRole } from '@sdr/shared';

export interface ApiKeyVerification {
  valid: boolean;
  organizationId?: string;
  role?: MemberRole;
  scopes?: string[];
  keyId?: string;
  error?: string;
}

export class OrganizationRepository {
  constructor(private readonly db: AnyDbClient) {}

  // --- MEMBERS ---
  async listMembers(organizationId: string) {
    const { data, error } = await this.db
      .from('organization_members')
      .select('organization_id, user_id, role, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async updateMemberRole(organizationId: string, userId: string, role: MemberRole) {
    const { data, error } = await this.db
      .from('organization_members')
      .update({ role })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async removeMember(organizationId: string, userId: string) {
    const { error } = await this.db
      .from('organization_members')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', userId);

    if (error) throw error;
    return { ok: true };
  }

  // --- INVITATIONS ---
  async listInvitations(organizationId: string) {
    const { data, error } = await this.db
      .from('invitations')
      .select('*')
      .eq('organization_id', organizationId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async createInvitation(organizationId: string, email: string, role: MemberRole = 'viewer') {
    const token = crypto.randomBytes(24).toString('hex');
    const { data, error } = await this.db
      .from('invitations')
      .insert({
        organization_id: organizationId,
        email: email.trim().toLowerCase(),
        role,
        token,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteInvitation(organizationId: string, invitationId: string) {
    const { error } = await this.db
      .from('invitations')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', invitationId);

    if (error) throw error;
    return { ok: true };
  }

  async acceptInvitation(token: string) {
    const { data, error } = await this.db.rpc('accept_invitation', { p_token: token });
    if (error) throw error;
    return { organizationId: data as string };
  }

  // --- API KEYS ---
  async listApiKeys(organizationId: string) {
    const { data, error } = await this.db
      .from('api_keys')
      .select('id, organization_id, name, key_prefix, role, scopes, created_at, expires_at, last_used_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async createApiKey(
    organizationId: string,
    name: string,
    role: MemberRole = 'viewer',
    scopes: string[] = ['flows:read'],
    expiresAt?: string
  ) {
    const secretPart = crypto.randomBytes(24).toString('hex');
    const rawKey = `sdr_live_${secretPart}`;
    const keyPrefix = rawKey.slice(0, 14); // "sdr_live_xxxx"
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const { data, error } = await this.db
      .from('api_keys')
      .insert({
        organization_id: organizationId,
        name: name.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        role,
        scopes,
        expires_at: expiresAt || null,
      })
      .select()
      .single();

    if (error) throw error;

    return {
      rawKey,
      key: data,
    };
  }

  async deleteApiKey(organizationId: string, keyId: string) {
    const { error } = await this.db
      .from('api_keys')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', keyId);

    if (error) throw error;
    return { ok: true };
  }

  async verifyApiKey(rawKey: string): Promise<ApiKeyVerification> {
    if (!rawKey || !rawKey.startsWith('sdr_live_')) {
      return { valid: false, error: 'Formato de chave de API inválido.' };
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const { data, error } = await this.db
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (error || !data) {
      return { valid: false, error: 'Chave de API inválida ou inexistente.' };
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { valid: false, error: 'Chave de API expirada.' };
    }

    // Update last_used_at asynchronously
    void this.db
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id);

    return {
      valid: true,
      organizationId: data.organization_id,
      role: data.role as MemberRole,
      scopes: data.scopes || [],
      keyId: data.id,
    };
  }
}
