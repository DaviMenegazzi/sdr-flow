import type { Database, Json } from './database.types.js';
import type { AnyDbClient } from './execution-repository.js';

export class ConversationRepository {
  constructor(private readonly db: AnyDbClient) {}

  async findOrCreateLead(organizationId: string, phone: string, name?: string | null) {
    const { data: existing } = await this.db
      .from('leads')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      if (name && !existing.name) {
        const { data: updated } = await this.db
          .from('leads')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .eq('organization_id', organizationId)
          .select()
          .single();
        return updated || existing;
      }
      return existing;
    }

    const { data: created, error } = await this.db
      .from('leads')
      .insert({
        organization_id: organizationId,
        phone,
        name: name || null,
        memory: {},
      })
      .select()
      .single();

    if (error) throw error;
    return created;
  }

  async updateLead(
    organizationId: string,
    leadId: string,
    data: {
      name?: string | null;
      city?: string | null;
      interest?: string | null;
      urgency?: string | null;
      memory?: Record<string, unknown>;
    }
  ) {
    const patch: Database['public']['Tables']['leads']['Update'] = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.city !== undefined) patch.city = data.city;
    if (data.interest !== undefined) patch.interest = data.interest;
    if (data.urgency !== undefined) patch.urgency = data.urgency;
    if (data.memory !== undefined) patch.memory = data.memory as Json;

    const { data: updated, error } = await this.db
      .from('leads')
      .update(patch)
      .eq('id', leadId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  async findOrCreateConversation(
    organizationId: string,
    connectionId: string,
    leadId: string,
    flowVersionId?: string | null
  ) {
    // Look for active conversation (not CLOSED, not CONVERTED)
    const { data: existing } = await this.db
      .from('conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('connection_id', connectionId)
      .eq('lead_id', leadId)
      .not('stage', 'in', '("CONVERTED","CLOSED")')
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (existing) {
      return existing;
    }

    const { data: created, error } = await this.db
      .from('conversations')
      .insert({
        organization_id: organizationId,
        connection_id: connectionId,
        lead_id: leadId,
        flow_version_id: flowVersionId || null,
        stage: 'NEW_CONVERSATION',
        handled_by: 'AI',
        bot_paused: false,
      })
      .select()
      .single();

    if (error) throw error;
    return created;
  }

  async updateConversation(
    organizationId: string,
    conversationId: string,
    data: {
      stage?: any;
      bot_paused?: boolean;
      handled_by?: 'AI' | 'HUMAN' | 'SYSTEM';
      flow_version_id?: string | null;
      last_message_at?: string;
    }
  ) {
    const patch: Database['public']['Tables']['conversations']['Update'] = { updated_at: new Date().toISOString() };
    if (data.stage !== undefined) patch.stage = data.stage;
    if (data.bot_paused !== undefined) patch.bot_paused = data.bot_paused;
    if (data.handled_by !== undefined) patch.handled_by = data.handled_by;
    if (data.flow_version_id !== undefined) patch.flow_version_id = data.flow_version_id;
    if (data.last_message_at !== undefined) patch.last_message_at = data.last_message_at;

    const { data: updated, error } = await this.db
      .from('conversations')
      .update(patch)
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  async saveMessage(input: {
    organizationId: string;
    connectionId: string;
    conversationId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    sender: 'lead' | 'ai' | 'human' | 'system';
    content: string;
    messageType?: string;
    providerMessageId?: string | null;
  }) {
    const { data, error } = await this.db
      .from('messages')
      .insert({
        organization_id: input.organizationId,
        connection_id: input.connectionId,
        conversation_id: input.conversationId,
        direction: input.direction,
        sender: input.sender,
        content: input.content,
        message_type: input.messageType || 'text',
        provider_message_id: input.providerMessageId || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Keep conversations.last_message_at in sync so the Inbox list sorts
    // and previews correctly. This was previously never updated after the
    // conversation's creation, so every conversation appeared frozen at
    // whatever time it first started regardless of how many messages
    // followed. Best-effort: the message itself is already saved, so a
    // failure here shouldn't fail the whole call.
    const { error: touchError } = await this.db
      .from('conversations')
      .update({ last_message_at: data.created_at, updated_at: data.created_at })
      .eq('id', input.conversationId)
      .eq('organization_id', input.organizationId);
    if (touchError) {
      console.warn('[ConversationRepository] Falha ao atualizar last_message_at:', touchError);
    }

    return data;
  }

  async syncDeal(
    organizationId: string,
    leadId: string,
    deal: { title: string; status: 'OPEN' | 'WON' | 'LOST'; score?: number }
  ) {
    const { data: existing } = await this.db
      .from('deals')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (existing) {
      const { data: updated, error } = await this.db
        .from('deals')
        .update({
          title: deal.title,
          status: deal.status,
          score: deal.score ?? existing.score,
        })
        .eq('id', existing.id)
        .eq('organization_id', organizationId)
        .select()
        .single();
      if (error) throw error;
      return updated;
    }

    const { data: created, error } = await this.db
      .from('deals')
      .insert({
        organization_id: organizationId,
        lead_id: leadId,
        title: deal.title,
        status: deal.status,
        score: deal.score ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return created;
  }
}
