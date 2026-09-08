import type { Database, Json } from './database.types.js';

export interface ConversationWithLead {
  id: string;
  organization_id: string;
  connection_id: string;
  lead_id: string;
  flow_version_id: string | null;
  stage: Database['public']['Enums']['conversation_stage'];
  bot_paused: boolean;
  handled_by: 'AI' | 'HUMAN' | 'SYSTEM';
  assigned_user_id: string | null;
  last_message_at: string | null;
  stage_updated_at: string;
  created_at: string;
  updated_at: string;
  lead: {
    id: string;
    phone: string;
    name: string | null;
    city: string | null;
    interest: string | null;
    urgency: string | null;
    memory: Record<string, unknown>;
  };
  connection?: {
    id: string;
    name: string;
    provider: string;
    phone_number: string | null;
  } | null;
  deal?: {
    id: string;
    title: string;
    status: string;
    score: number | null;
  } | null;
  last_message?: {
    id: string;
    sender: string;
    direction: string;
    content: string;
    created_at: string;
  } | null;
}

export interface ListInboxFilters {
  stage?: string;
  connectionId?: string;
  assignedUserId?: string | null;
  handledBy?: 'AI' | 'HUMAN' | 'SYSTEM';
  search?: string;
  limit?: number;
  offset?: number;
}

export class InboxRepository {
  constructor(private readonly db: any) {}

  async listConversations(
    organizationId: string,
    filters: ListInboxFilters = {}
  ): Promise<{ conversations: ConversationWithLead[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      let whereClauses = [`c.organization_id = $1`];
      const params: any[] = [organizationId];
      let paramIdx = 2;

      if (filters.connectionId) {
        whereClauses.push(`c.connection_id = $${paramIdx++}`);
        params.push(filters.connectionId);
      }

      if (filters.stage && filters.stage !== 'ALL') {
        whereClauses.push(`c.stage = $${paramIdx++}`);
        params.push(filters.stage);
      }

      if (filters.handledBy) {
        whereClauses.push(`c.handled_by = $${paramIdx++}`);
        params.push(filters.handledBy);
      }

      if (filters.assignedUserId !== undefined) {
        if (filters.assignedUserId === null) {
          whereClauses.push(`c.assigned_user_id is null`);
        } else {
          whereClauses.push(`c.assigned_user_id = $${paramIdx++}`);
          params.push(filters.assignedUserId);
        }
      }

      if (filters.search && filters.search.trim().length > 0) {
        const term = `%${filters.search.trim().toLowerCase()}%`;
        whereClauses.push(`(lower(l.name) like $${paramIdx} or l.phone like $${paramIdx} or lower(m_last.content) like $${paramIdx})`);
        params.push(term);
        paramIdx++;
      }

      const whereSql = whereClauses.join(' and ');

      const countSql = `
        select count(*)::int as total
        from public.conversations c
        join public.leads l on l.id = c.lead_id
        left join lateral (
          select content from public.messages m
          where m.conversation_id = c.id
          order by m.created_at desc limit 1
        ) m_last on true
        where ${whereSql}
      `;
      const countRes = await this.db.query(countSql, params);
      const total = countRes.rows[0]?.total || 0;

      const dataSql = `
        select 
          c.*,
          l.phone as lead_phone,
          l.name as lead_name,
          l.city as lead_city,
          l.interest as lead_interest,
          l.urgency as lead_urgency,
          l.memory as lead_memory,
          conn.name as connection_name,
          conn.provider as connection_provider,
          conn.phone as connection_phone_number,
          d.id as deal_id,
          d.title as deal_title,
          d.status as deal_status,
          d.score as deal_score,
          m_last.id as last_msg_id,
          m_last.sender as last_msg_sender,
          m_last.direction as last_msg_direction,
          m_last.content as last_msg_content,
          m_last.created_at as last_msg_created_at
        from public.conversations c
        join public.leads l on l.id = c.lead_id
        left join public.connections conn on conn.id = c.connection_id
        left join lateral (
          select id, title, status, score from public.deals
          where lead_id = c.lead_id and organization_id = c.organization_id
          order by created_at desc limit 1
        ) d on true
        left join lateral (
          select id, sender, direction, content, created_at from public.messages
          where conversation_id = c.id
          order by created_at desc limit 1
        ) m_last on true
        where ${whereSql}
        order by coalesce(c.last_message_at, c.created_at) desc
        limit $${paramIdx++} offset $${paramIdx++}
      `;
      params.push(limit, offset);
      const dataRes = await this.db.query(dataSql, params);

      const conversations: ConversationWithLead[] = dataRes.rows.map((row: any) => ({
        id: row.id,
        organization_id: row.organization_id,
        connection_id: row.connection_id,
        lead_id: row.lead_id,
        flow_version_id: row.flow_version_id,
        stage: row.stage,
        bot_paused: row.bot_paused,
        handled_by: row.handled_by,
        assigned_user_id: row.assigned_user_id,
        last_message_at: row.last_message_at,
        stage_updated_at: row.stage_updated_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        lead: {
          id: row.lead_id,
          phone: row.lead_phone,
          name: row.lead_name,
          city: row.lead_city,
          interest: row.lead_interest,
          urgency: row.lead_urgency,
          memory: typeof row.lead_memory === 'string' ? JSON.parse(row.lead_memory) : row.lead_memory || {},
        },
        connection: row.connection_name ? {
          id: row.connection_id,
          name: row.connection_name,
          provider: row.connection_provider,
          phone_number: row.connection_phone_number,
        } : null,
        deal: row.deal_id ? {
          id: row.deal_id,
          title: row.deal_title,
          status: row.deal_status,
          score: row.deal_score,
        } : null,
        last_message: row.last_msg_id ? {
          id: row.last_msg_id,
          sender: row.last_msg_sender,
          direction: row.last_msg_direction,
          content: row.last_msg_content,
          created_at: row.last_msg_created_at,
        } : null,
      }));

      return { conversations, total };
    }

    // Supabase query builder
    let query = this.db
      .from('conversations')
      .select('*, lead:leads(*), connection:connections(id, name, provider, phone)', { count: 'exact' })
      .eq('organization_id', organizationId);

    if (filters.connectionId) {
      query = query.eq('connection_id', filters.connectionId);
    }
    if (filters.stage && filters.stage !== 'ALL') {
      query = query.eq('stage', filters.stage);
    }
    if (filters.handledBy) {
      query = query.eq('handled_by', filters.handledBy);
    }
    if (filters.assignedUserId !== undefined) {
      if (filters.assignedUserId === null) {
        query = query.is('assigned_user_id', null);
      } else {
        query = query.eq('assigned_user_id', filters.assignedUserId);
      }
    }

    query = query
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    const conversations: ConversationWithLead[] = (data || []).map((row: any) => ({
      ...row,
      lead: {
        ...row.lead,
        memory: (row.lead?.memory || {}) as Record<string, unknown>,
      },
      connection: row.connection || null,
      deal: null,
      last_message: null,
    }));

    return { conversations, total: count || conversations.length };
  }

  async getConversation(
    organizationId: string,
    conversationId: string
  ): Promise<ConversationWithLead | null> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const sql = `
        select 
          c.*,
          l.phone as lead_phone,
          l.name as lead_name,
          l.city as lead_city,
          l.interest as lead_interest,
          l.urgency as lead_urgency,
          l.memory as lead_memory,
          conn.name as connection_name,
          conn.provider as connection_provider,
          conn.phone as connection_phone_number,
          d.id as deal_id,
          d.title as deal_title,
          d.status as deal_status,
          d.score as deal_score
        from public.conversations c
        join public.leads l on l.id = c.lead_id
        left join public.connections conn on conn.id = c.connection_id
        left join lateral (
          select id, title, status, score from public.deals
          where lead_id = c.lead_id and organization_id = c.organization_id
          order by created_at desc limit 1
        ) d on true
        where c.organization_id = $1 and c.id = $2
      `;
      const res = await this.db.query(sql, [organizationId, conversationId]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];

      return {
        id: row.id,
        organization_id: row.organization_id,
        connection_id: row.connection_id,
        lead_id: row.lead_id,
        flow_version_id: row.flow_version_id,
        stage: row.stage,
        bot_paused: row.bot_paused,
        handled_by: row.handled_by,
        assigned_user_id: row.assigned_user_id,
        last_message_at: row.last_message_at,
        stage_updated_at: row.stage_updated_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        lead: {
          id: row.lead_id,
          phone: row.lead_phone,
          name: row.lead_name,
          city: row.lead_city,
          interest: row.lead_interest,
          urgency: row.lead_urgency,
          memory: typeof row.lead_memory === 'string' ? JSON.parse(row.lead_memory) : row.lead_memory || {},
        },
        connection: row.connection_name ? {
          id: row.connection_id,
          name: row.connection_name,
          provider: row.connection_provider,
          phone_number: row.connection_phone_number,
        } : null,
        deal: row.deal_id ? {
          id: row.deal_id,
          title: row.deal_title,
          status: row.deal_status,
          score: row.deal_score,
        } : null,
      };
    }

    const { data, error } = await this.db
      .from('conversations')
      .select('*, lead:leads(*), connection:connections(id, name, provider, phone)')
      .eq('organization_id', organizationId)
      .eq('id', conversationId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      ...data,
      lead: {
        ...data.lead,
        memory: (data.lead?.memory || {}) as Record<string, unknown>,
      },
      connection: data.connection || null,
      deal: null,
    };
  }

  async getMessages(
    organizationId: string,
    conversationId: string,
    limit = 100
  ): Promise<Database['public']['Tables']['messages']['Row'][]> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const sql = `
        select * from public.messages
        where organization_id = $1 and conversation_id = $2
        order by created_at asc
        limit $3
      `;
      const res = await this.db.query(sql, [organizationId, conversationId, limit]);
      return res.rows;
    }

    const { data, error } = await this.db
      .from('messages')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  async takeover(
    organizationId: string,
    conversationId: string,
    userId: string
  ): Promise<ConversationWithLead> {
    const now = new Date().toISOString();

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      await this.db.query(
        `update public.conversations
         set handled_by = 'HUMAN', bot_paused = true, assigned_user_id = $3, updated_at = $4
         where organization_id = $1 and id = $2`,
        [organizationId, conversationId, userId, now]
      );

      await this.db.query(
        `insert into public.audit_events (organization_id, actor_id, action, entity_id, details)
         values ($1, $2, 'conversation.takeover', $3, $4)`,
        [organizationId, userId, conversationId, JSON.stringify({ handled_by: 'HUMAN', bot_paused: true })]
      );
    } else {
      const { error } = await this.db
        .from('conversations')
        .update({
          handled_by: 'HUMAN',
          bot_paused: true,
          assigned_user_id: userId,
          updated_at: now,
        })
        .eq('organization_id', organizationId)
        .eq('id', conversationId);

      if (error) throw error;

      await this.db.from('audit_events').insert({
        organization_id: organizationId,
        actor_id: userId,
        action: 'conversation.takeover',
        entity_id: conversationId,
        details: { handled_by: 'HUMAN', bot_paused: true } as Json,
      });
    }

    const conv = await this.getConversation(organizationId, conversationId);
    if (!conv) throw new Error('Conversa não encontrada após takeover.');
    return conv;
  }

  async release(
    organizationId: string,
    conversationId: string,
    userId: string
  ): Promise<ConversationWithLead> {
    const now = new Date().toISOString();

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      await this.db.query(
        `update public.conversations
         set handled_by = 'AI', bot_paused = false, updated_at = $3
         where organization_id = $1 and id = $2`,
        [organizationId, conversationId, now]
      );

      await this.db.query(
        `insert into public.audit_events (organization_id, actor_id, action, entity_id, details)
         values ($1, $2, 'conversation.release', $3, $4)`,
        [organizationId, userId, conversationId, JSON.stringify({ handled_by: 'AI', bot_paused: false })]
      );
    } else {
      const { error } = await this.db
        .from('conversations')
        .update({
          handled_by: 'AI',
          bot_paused: false,
          updated_at: now,
        })
        .eq('organization_id', organizationId)
        .eq('id', conversationId);

      if (error) throw error;

      await this.db.from('audit_events').insert({
        organization_id: organizationId,
        actor_id: userId,
        action: 'conversation.release',
        entity_id: conversationId,
        details: { handled_by: 'AI', bot_paused: false } as Json,
      });
    }

    const conv = await this.getConversation(organizationId, conversationId);
    if (!conv) throw new Error('Conversa não encontrada após release.');
    return conv;
  }

  async assign(
    organizationId: string,
    conversationId: string,
    targetUserId: string | null,
    actorId: string
  ): Promise<ConversationWithLead> {
    const now = new Date().toISOString();

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      await this.db.query(
        `update public.conversations
         set assigned_user_id = $3, updated_at = $4
         where organization_id = $1 and id = $2`,
        [organizationId, conversationId, targetUserId, now]
      );

      await this.db.query(
        `insert into public.audit_events (organization_id, actor_id, action, entity_id, details)
         values ($1, $2, 'conversation.assigned', $3, $4)`,
        [organizationId, actorId, conversationId, JSON.stringify({ assigned_user_id: targetUserId })]
      );
    } else {
      const { error } = await this.db
        .from('conversations')
        .update({
          assigned_user_id: targetUserId,
          updated_at: now,
        })
        .eq('organization_id', organizationId)
        .eq('id', conversationId);

      if (error) throw error;

      await this.db.from('audit_events').insert({
        organization_id: organizationId,
        actor_id: actorId,
        action: 'conversation.assigned',
        entity_id: conversationId,
        details: { assigned_user_id: targetUserId } as Json,
      });
    }

    const conv = await this.getConversation(organizationId, conversationId);
    if (!conv) throw new Error('Conversa não encontrada após atribuição.');
    return conv;
  }

  async updateStage(
    organizationId: string,
    conversationId: string,
    stage: Database['public']['Enums']['conversation_stage'],
    actorId: string
  ): Promise<ConversationWithLead> {
    const now = new Date().toISOString();

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      await this.db.query(
        `update public.conversations
         set stage = $3, stage_updated_at = $4, updated_at = $4
         where organization_id = $1 and id = $2`,
        [organizationId, conversationId, stage, now]
      );

      await this.db.query(
        `insert into public.audit_events (organization_id, actor_id, action, entity_id, details)
         values ($1, $2, 'conversation.stage_changed', $3, $4)`,
        [organizationId, actorId, conversationId, JSON.stringify({ stage })]
      );
    } else {
      const { error } = await this.db
        .from('conversations')
        .update({
          stage,
          stage_updated_at: now,
          updated_at: now,
        })
        .eq('organization_id', organizationId)
        .eq('id', conversationId);

      if (error) throw error;

      await this.db.from('audit_events').insert({
        organization_id: organizationId,
        actor_id: actorId,
        action: 'conversation.stage_changed',
        entity_id: conversationId,
        details: { stage } as Json,
      });
    }

    const conv = await this.getConversation(organizationId, conversationId);
    if (!conv) throw new Error('Conversa não encontrada após alteração de estágio.');
    return conv;
  }

  async sendHumanMessage(input: {
    organizationId: string;
    connectionId: string;
    conversationId: string;
    content: string;
    actorId: string;
  }): Promise<Database['public']['Tables']['messages']['Row']> {
    const now = new Date().toISOString();

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const msgRes = await this.db.query(
        `insert into public.messages (organization_id, connection_id, conversation_id, direction, sender, content, message_type, created_at)
         values ($1, $2, $3, 'OUTBOUND', 'human', $4, 'text', $5)
         returning *`,
        [input.organizationId, input.connectionId, input.conversationId, input.content, now]
      );

      await this.db.query(
        `update public.conversations
         set last_message_at = $3, updated_at = $3
         where organization_id = $1 and id = $2`,
        [input.organizationId, input.conversationId, now]
      );

      return msgRes.rows[0];
    }

    const { data: msg, error: msgError } = await this.db
      .from('messages')
      .insert({
        organization_id: input.organizationId,
        connection_id: input.connectionId,
        conversation_id: input.conversationId,
        direction: 'OUTBOUND',
        sender: 'human',
        content: input.content,
        message_type: 'text',
        created_at: now,
      })
      .select()
      .single();

    if (msgError) throw msgError;

    await this.db
      .from('conversations')
      .update({
        last_message_at: now,
        updated_at: now,
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.conversationId);

    return msg;
  }
}
