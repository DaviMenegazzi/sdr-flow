import type { Database, Json } from './database.types.js';
import type { AnyDbClient } from './execution-repository.js';

export class ConversationRepository {
  constructor(private readonly db: AnyDbClient) {}

  // Atomic upsert via the find_or_create_lead RPC (see
  // supabase/migrations/202609141001_inbound_events.sql): closes the select-then-insert race
  // that let two concurrent webhook deliveries for a brand-new lead both miss the SELECT and
  // both attempt an INSERT, with the loser throwing an unhandled unique-violation.
  async findOrCreateLead(organizationId: string, connectionId: string, phone: string, name?: string | null) {
    const { data, error } = await this.db.rpc('find_or_create_lead', {
      p_organization_id: organizationId,
      p_connection_id: connectionId,
      p_phone: phone,
      p_name: name || null,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
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

  /** Marks a lead as a group and refreshes its title without ever using a participant name.
   * `options.synced` marks the name as confirmed against Evolution's own group catalog (as
   * opposed to the "Grupo • <id>" placeholder used while Evolution is unreachable), recorded in
   * group_subject_synced_at for the manual resync script to report staleness after a rename. */
  async syncGroupIdentity(organizationId: string, leadId: string, groupName?: string | null, options?: { synced?: boolean }) {
    const patch: Database['public']['Tables']['leads']['Update'] = { is_group: true, updated_at: new Date().toISOString() };
    if (groupName?.trim()) {
      patch.group_subject = groupName.trim();
      patch.name = groupName.trim();
    }
    if (options?.synced) patch.group_subject_synced_at = new Date().toISOString();
    const { error } = await this.db.from('leads').update(patch).eq('organization_id', organizationId).eq('id', leadId);
    if (error) throw error;
  }

  async resetVolatileLeadTurnState(
    organizationId: string,
    leadId: string,
    timestamp?: string,
    leadRef?: { memory?: unknown; [key: string]: unknown }
  ) {
    try {
      let memoryObj: Record<string, unknown> | null = null;
      if (leadRef && leadRef.memory && typeof leadRef.memory === 'object') {
        memoryObj = leadRef.memory as Record<string, unknown>;
      } else {
        const { data: lead } = await this.db
          .from('leads')
          .select('memory')
          .eq('organization_id', organizationId)
          .eq('id', leadId)
          .maybeSingle();
        if (lead && lead.memory && typeof lead.memory === 'object') {
          memoryObj = lead.memory as Record<string, unknown>;
        }
      }

      if (!memoryObj) return;

      const mem = { ...memoryObj };
      const nowIso = timestamp || new Date().toISOString();

      if (mem.conversation_state && typeof mem.conversation_state === 'object') {
        mem.conversation_state = {
          stage: 'NEW_CONVERSATION',
          updated_at: nowIso,
          last_action: null,
          next_expected_input: null,
        };
      }

      if (mem.custom_fields && typeof mem.custom_fields === 'object') {
        const custom = { ...(mem.custom_fields as Record<string, unknown>) };
        delete custom.proximo_passo;
        delete custom.selected_slot_iso;
        delete custom.desired_day;
        delete custom.desired_date;
        delete custom.desired_period;
        delete custom.period;
        if (custom.conversation_state) {
          custom.conversation_state = {
            stage: 'NEW_CONVERSATION',
            updated_at: nowIso,
            last_action: null,
            next_expected_input: null,
          };
        }
        mem.custom_fields = custom;
      }

      if (mem.attributes && typeof mem.attributes === 'object') {
        const attrs = { ...(mem.attributes as Record<string, unknown>) };
        delete attrs.proximo_passo;
        delete attrs.selected_slot_iso;
        delete attrs.desired_day;
        delete attrs.desired_date;
        delete attrs.desired_period;
        delete attrs.period;
        if (attrs.conversation_state) {
          attrs.conversation_state = {
            stage: 'NEW_CONVERSATION',
            updated_at: nowIso,
            last_action: null,
            next_expected_input: null,
          };
        }
        mem.attributes = attrs;
      }

      mem.objections = [];

      if (leadRef) {
        leadRef.memory = mem;
      }

      await this.db
        .from('leads')
        .update({
          memory: mem as Json,
          updated_at: nowIso,
        })
        .eq('organization_id', organizationId)
        .eq('id', leadId);
    } catch (err) {
      console.warn('[ConversationRepository] Falha ao resetar estado volátil do lead:', err);
    }
  }

  async findOrCreateConversation(
    organizationId: string,
    connectionId: string,
    leadId: string,
    flowVersionId?: string | null,
    options?: {
      sessionTimeoutMinutes?: number;
      now?: Date;
      lead?: { memory?: unknown; [key: string]: unknown };
    }
  ) {
    const sessionTimeoutMinutes = options?.sessionTimeoutMinutes ?? 15;
    const now = options?.now ? options.now.getTime() : Date.now();

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

    // Set only when a prior, now-expired conversation is being superseded — how long the lead
    // went quiet before this message. Callers use it to keep the AI from silently resuming an
    // old thread (e.g. re-asking about a days-old interest) off the back of a bare "boa noite".
    let resumedAfterGapMinutes: number | null = null;

    if (existing) {
      const lastActivityStr = existing.last_message_at || existing.updated_at || existing.created_at;
      const lastActivityTime = lastActivityStr ? new Date(lastActivityStr).getTime() : 0;
      const isExpired = sessionTimeoutMinutes > 0 && lastActivityTime > 0 && (now - lastActivityTime) >= sessionTimeoutMinutes * 60 * 1000;

      if (isExpired) {
        const nowDateStr = new Date(now).toISOString();
        resumedAfterGapMinutes = Math.round((now - lastActivityTime) / 60000);
        await this.db
          .from('conversations')
          .update({
            stage: 'CLOSED',
            updated_at: nowDateStr,
            stage_updated_at: nowDateStr,
          })
          .eq('id', existing.id)
          .eq('organization_id', organizationId);

        await this.resetVolatileLeadTurnState(organizationId, leadId, nowDateStr, options?.lead);
      } else {
        return { ...existing, created: false, resumedAfterGapMinutes: null };
      }
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

    if (error) {
      // Lost the race: another concurrent call for the same lead (routine with WhatsApp
      // group chatter arriving in a burst) already inserted the active conversation between
      // our SELECT above and this INSERT. conversations_one_active_per_lead_idx (see
      // supabase/migrations/202609151001_conversations_one_active_per_lead.sql) turns that
      // into a unique_violation instead of letting both requests create a row — reuse the
      // winner's row rather than duplicating it or failing the turn.
      if ((error as { code?: string }).code === '23505') {
        const { data: winner, error: winnerError } = await this.db
          .from('conversations')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('connection_id', connectionId)
          .eq('lead_id', leadId)
          .not('stage', 'in', '("CONVERTED","CLOSED")')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (winnerError || !winner) throw winnerError || error;
        return { ...winner, created: false, resumedAfterGapMinutes: null };
      }
      throw error;
    }
    // `created` lets callers (turn-processor) emit inbox:conversation.created only once, instead
    // of guessing from timestamps — the prior CLOSED-and-superseded branch above also inserts a
    // fresh row, so this is a genuinely new conversation either way.
    return { ...created, created: true, resumedAfterGapMinutes };
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

  // Idempotent by provider_message_id via the save_inbound_message RPC (see
  // supabase/migrations/202609141001_inbound_events.sql): a retried delivery for the same
  // message returns the existing row instead of throwing on the unique-constraint violation,
  // and conversations.last_message_at only ever advances, atomically with the insert.
  async saveMessage(input: {
    organizationId: string;
    connectionId: string;
    conversationId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    sender: 'lead' | 'ai' | 'human' | 'system';
    content: string;
    messageType?: string;
    providerMessageId?: string | null;
    senderName?: string | null;
    senderJid?: string | null;
  }): Promise<{ id: string; created_at: string; created: boolean }> {
    const { data, error } = await this.db.rpc('save_inbound_message', {
      p_organization_id: input.organizationId,
      p_connection_id: input.connectionId,
      p_conversation_id: input.conversationId,
      p_direction: input.direction,
      p_sender: input.sender,
      p_content: input.content,
      p_message_type: input.messageType || 'text',
      p_provider_message_id: input.providerMessageId || null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('save_inbound_message retornou vazio.');
    // The idempotent RPC owns the message insert. Metadata belongs only to a new inbound row;
    // never update an existing row when a provider retries the same message id.
    if (row.is_new && (input.senderName || input.senderJid)) {
      const { error: metadataError } = await this.db
        .from('messages')
        .update({ sender_name: input.senderName || null, sender_jid: input.senderJid || null })
        .eq('organization_id', input.organizationId)
        .eq('id', row.id);
      if (metadataError) throw metadataError;
    }
    return { id: row.id, created_at: row.created_at, created: row.is_new };
  }

  async getMessages(
    organizationId: string,
    conversationId: string,
    limit = 50
  ): Promise<Array<{ id: string; content: string; sender: string; direction: string }>> {
    const { data, error } = await this.db
      .from('messages')
      .select('id, content, sender, direction')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const rows = data || [];
    rows.reverse();
    return rows;
  }

  async getLeadRecentMessages(
    organizationId: string,
    leadId: string,
    limit = 20
  ): Promise<Array<{ id: string; conversation_id: string; content: string; sender: string; direction: string; created_at?: string }>> {
    const { data: convs, error: convErr } = await this.db
      .from('conversations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (convErr || !convs || convs.length === 0) return [];
    const convIds = convs.map((c: any) => c.id);

    const { data, error } = await this.db
      .from('messages')
      .select('id, conversation_id, content, sender, direction, created_at')
      .eq('organization_id', organizationId)
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const rows = data || [];
    rows.reverse();
    return rows;
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
