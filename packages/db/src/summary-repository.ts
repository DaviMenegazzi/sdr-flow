export interface ConversationSummaryEntity {
  id: string;
  organization_id: string;
  conversation_id: string;
  summary: string;
  last_message_id: string | null;
  messages_count: number;
  tokens_used: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertSummaryInput {
  summary: string;
  lastMessageId?: string | null;
  messagesCount?: number;
  tokensUsed?: number;
}

export class SummaryRepository {
  constructor(private readonly db: any) {}

  async getSummary(organizationId: string, conversationId: string): Promise<string | null> {
    const record = await this.getSummaryRecord(organizationId, conversationId);
    return record?.summary ?? null;
  }

  async getSummaryRecord(
    organizationId: string,
    conversationId: string
  ): Promise<ConversationSummaryEntity | null> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const res = await this.db.query(
        `select * from public.conversation_summaries where organization_id = $1 and conversation_id = $2`,
        [organizationId, conversationId]
      );
      return res.rows[0] ?? null;
    }

    const { data, error } = await this.db
      .from('conversation_summaries')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get conversation summary: ${error.message}`);
    }
    return data ?? null;
  }

  async upsertSummary(
    organizationId: string,
    conversationId: string,
    input: UpsertSummaryInput
  ): Promise<ConversationSummaryEntity> {
    const existing = await this.getSummaryRecord(organizationId, conversationId);

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      if (existing) {
        const res = await this.db.query(
          `update public.conversation_summaries
           set summary = $1, last_message_id = coalesce($2, last_message_id),
               messages_count = coalesce($3, messages_count), tokens_used = tokens_used + coalesce($4, 0),
               updated_at = now()
           where organization_id = $5 and conversation_id = $6
           returning *`,
          [
            input.summary,
            input.lastMessageId ?? null,
            input.messagesCount ?? null,
            input.tokensUsed ?? 0,
            organizationId,
            conversationId,
          ]
        );
        return res.rows[0];
      } else {
        const res = await this.db.query(
          `insert into public.conversation_summaries (organization_id, conversation_id, summary, last_message_id, messages_count, tokens_used)
           values ($1, $2, $3, $4, $5, $6)
           returning *`,
          [
            organizationId,
            conversationId,
            input.summary,
            input.lastMessageId ?? null,
            input.messagesCount ?? 0,
            input.tokensUsed ?? 0,
          ]
        );
        return res.rows[0];
      }
    }

    if (existing) {
      const { data, error } = await this.db
        .from('conversation_summaries')
        .update({
          summary: input.summary,
          last_message_id: input.lastMessageId ?? existing.last_message_id,
          messages_count: input.messagesCount ?? existing.messages_count,
          tokens_used: (existing.tokens_used || 0) + (input.tokensUsed || 0),
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId)
        .eq('conversation_id', conversationId)
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to update conversation summary: ${error?.message || 'Unknown error'}`);
      }
      return data;
    } else {
      const { data, error } = await this.db
        .from('conversation_summaries')
        .insert({
          organization_id: organizationId,
          conversation_id: conversationId,
          summary: input.summary,
          last_message_id: input.lastMessageId ?? null,
          messages_count: input.messagesCount ?? 0,
          tokens_used: input.tokensUsed ?? 0,
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to create conversation summary: ${error?.message || 'Unknown error'}`);
      }
      return data;
    }
  }
}
