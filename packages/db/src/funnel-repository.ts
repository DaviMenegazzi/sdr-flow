import type { Database } from './database.types.js';
import type { AnyDbClient } from './execution-repository.js';

type ConversationStage = Database['public']['Enums']['conversation_stage'];
export type LeadTemperature = 'HOT' | 'WARM' | 'COLD';

export interface LeadFunnelMove {
  leadId: string;
  conversationId?: string | null;
  from: ConversationStage;
  to: ConversationStage;
  source: 'flow_signal' | 'text_rule' | 'laya';
  reason: string;
  evidence?: string | null;
  confidence?: number | null;
}

export class FunnelRepository {
  constructor(private readonly db: AnyDbClient) {}

  async getLeadFunnel(organizationId: string, leadId: string) {
    const { data, error } = await this.db
      .from('leads')
      .select('id, funnel_stage, is_group')
      .eq('organization_id', organizationId)
      .eq('id', leadId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Whether the SDR (sender 'ai') ever answered this lead. conversations.stage HUMAN_HANDOFF is
   * not proof of that: the webhook also sets it whenever the owner types from the phone, which
   * covers personal and supplier chats that must stay out of the sales funnel.
   */
  async leadHasSdrReplies(organizationId: string, leadId: string): Promise<boolean> {
    const { data: conversations, error } = await this.db
      .from('conversations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    if (!conversations || conversations.length === 0) return false;
    const { data: replies, error: messagesError } = await this.db
      .from('messages')
      .select('id')
      .eq('organization_id', organizationId)
      .in('conversation_id', conversations.map((conversation: { id: string }) => conversation.id))
      .eq('sender', 'ai')
      .limit(1);
    if (messagesError) throw messagesError;
    return (replies?.length ?? 0) > 0;
  }

  /**
   * Moves leads.funnel_stage only if it still equals `move.from`, so a Laya job and a turn racing
   * on the same lead cannot overwrite each other. Returns false when someone else moved it first.
   */
  async moveLeadFunnel(organizationId: string, move: LeadFunnelMove): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from('leads')
      .update({ funnel_stage: move.to, funnel_stage_updated_at: now, updated_at: now })
      .eq('organization_id', organizationId)
      .eq('id', move.leadId)
      .eq('funnel_stage', move.from)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return false;

    const { error: eventError } = await this.db.from('lead_stage_events').insert({
      organization_id: organizationId,
      lead_id: move.leadId,
      conversation_id: move.conversationId ?? null,
      from_stage: move.from,
      to_stage: move.to,
      source: move.source,
      reason: move.reason.slice(0, 500),
      evidence: move.evidence ? move.evidence.slice(0, 500) : null,
      confidence: move.confidence ?? null,
    });
    if (eventError) throw eventError;
    return true;
  }

  /** Lead score from the Laya classifier; mirrored onto the lead's latest deal when one exists (never creates one). */
  async setLeadScore(organizationId: string, leadId: string, score: number, temperature: LeadTemperature) {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('leads')
      .update({ lead_score: score, temperature, lead_score_updated_at: now })
      .eq('organization_id', organizationId)
      .eq('id', leadId);
    if (error) throw error;

    const { data: deal, error: dealError } = await this.db
      .from('deals')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dealError) throw dealError;
    if (deal) {
      const { error: updateError } = await this.db.from('deals').update({ score }).eq('organization_id', organizationId).eq('id', deal.id);
      if (updateError) throw updateError;
    }
  }
}
