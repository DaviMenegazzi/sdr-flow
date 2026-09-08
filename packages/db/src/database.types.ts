// Generated from supabase/migrations by pnpm db:types. Do not edit.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: {
    api_keys: {
      Row: {
        id: string;
        organization_id: string;
        name: string;
        key_hash: string;
        key_prefix: string;
        role: Database['public']['Enums']['member_role'];
        scopes: string[];
        created_by: string | null;
        expires_at: string | null;
        last_used_at: string | null;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        name: string;
        key_hash: string;
        key_prefix: string;
        role?: Database['public']['Enums']['member_role'];
        scopes?: string[];
        created_by?: string | null;
        expires_at?: string | null;
        last_used_at?: string | null;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        name?: string;
        key_hash?: string;
        key_prefix?: string;
        role?: Database['public']['Enums']['member_role'];
        scopes?: string[];
        created_by?: string | null;
        expires_at?: string | null;
        last_used_at?: string | null;
        created_at?: string;
      };
      Relationships: [];
    };
    audit_events: {
      Row: {
        id: string;
        organization_id: string;
        actor_id: string | null;
        action: string;
        entity_id: string | null;
        details: Json;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        actor_id?: string | null;
        action: string;
        entity_id?: string | null;
        details?: Json;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        actor_id?: string | null;
        action?: string;
        entity_id?: string | null;
        details?: Json;
        created_at?: string;
      };
      Relationships: [];
    };
    connections: {
      Row: {
        id: string;
        organization_id: string;
        name: string;
        provider: Database['public']['Enums']['connection_provider'];
        status: string;
        phone: string | null;
        provider_instance_id: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        name: string;
        provider: Database['public']['Enums']['connection_provider'];
        status?: string;
        phone?: string | null;
        provider_instance_id?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        name?: string;
        provider?: Database['public']['Enums']['connection_provider'];
        status?: string;
        phone?: string | null;
        provider_instance_id?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    conversation_summaries: {
      Row: {
        id: string;
        organization_id: string;
        conversation_id: string;
        summary: string;
        last_message_id: string | null;
        messages_count: number;
        tokens_used: number;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        conversation_id: string;
        summary: string;
        last_message_id?: string | null;
        messages_count?: number;
        tokens_used?: number;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        conversation_id?: string;
        summary?: string;
        last_message_id?: string | null;
        messages_count?: number;
        tokens_used?: number;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    conversations: {
      Row: {
        id: string;
        organization_id: string;
        connection_id: string;
        lead_id: string;
        flow_version_id: string | null;
        stage: Database['public']['Enums']['conversation_stage'];
        bot_paused: boolean;
        handled_by: string;
        assigned_user_id: string | null;
        last_message_at: string | null;
        created_at: string;
        updated_at: string;
        stage_updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        connection_id: string;
        lead_id: string;
        flow_version_id?: string | null;
        stage?: Database['public']['Enums']['conversation_stage'];
        bot_paused?: boolean;
        handled_by?: string;
        assigned_user_id?: string | null;
        last_message_at?: string | null;
        created_at?: string;
        updated_at?: string;
        stage_updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        connection_id?: string;
        lead_id?: string;
        flow_version_id?: string | null;
        stage?: Database['public']['Enums']['conversation_stage'];
        bot_paused?: boolean;
        handled_by?: string;
        assigned_user_id?: string | null;
        last_message_at?: string | null;
        created_at?: string;
        updated_at?: string;
        stage_updated_at?: string;
      };
      Relationships: [];
    };
    deals: {
      Row: {
        id: string;
        organization_id: string;
        lead_id: string;
        title: string;
        status: string;
        score: number | null;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        lead_id: string;
        title: string;
        status?: string;
        score?: number | null;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        lead_id?: string;
        title?: string;
        status?: string;
        score?: number | null;
        created_at?: string;
      };
      Relationships: [];
    };
    flow_execution_steps: {
      Row: {
        id: string;
        organization_id: string;
        execution_id: string;
        node_id: string;
        sequence: number;
        input: Json | null;
        output: Json | null;
        duration_ms: number | null;
        error: string | null;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        execution_id: string;
        node_id: string;
        sequence: number;
        input?: Json | null;
        output?: Json | null;
        duration_ms?: number | null;
        error?: string | null;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        execution_id?: string;
        node_id?: string;
        sequence?: number;
        input?: Json | null;
        output?: Json | null;
        duration_ms?: number | null;
        error?: string | null;
        created_at?: string;
      };
      Relationships: [];
    };
    flow_executions: {
      Row: {
        id: string;
        organization_id: string;
        conversation_id: string;
        flow_version_id: string;
        status: string;
        input_tokens: number;
        output_tokens: number;
        resume_node_id: string | null;
        created_at: string;
        finished_at: string | null;
      };
      Insert: {
        id?: string;
        organization_id: string;
        conversation_id: string;
        flow_version_id: string;
        status?: string;
        input_tokens?: number;
        output_tokens?: number;
        resume_node_id?: string | null;
        created_at?: string;
        finished_at?: string | null;
      };
      Update: {
        id?: string;
        organization_id?: string;
        conversation_id?: string;
        flow_version_id?: string;
        status?: string;
        input_tokens?: number;
        output_tokens?: number;
        resume_node_id?: string | null;
        created_at?: string;
        finished_at?: string | null;
      };
      Relationships: [];
    };
    flow_versions: {
      Row: {
        id: string;
        organization_id: string;
        flow_id: string;
        version: number;
        graph: Json;
        created_by: string | null;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        flow_id: string;
        version: number;
        graph: Json;
        created_by?: string | null;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        flow_id?: string;
        version?: number;
        graph?: Json;
        created_by?: string | null;
        created_at?: string;
      };
      Relationships: [];
    };
    flows: {
      Row: {
        id: string;
        organization_id: string;
        name: string;
        draft: Json;
        published_version_id: string | null;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        name: string;
        draft: Json;
        published_version_id?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        name?: string;
        draft?: Json;
        published_version_id?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    invitations: {
      Row: {
        id: string;
        organization_id: string;
        email: string;
        role: Database['public']['Enums']['member_role'];
        token: string;
        invited_by: string | null;
        expires_at: string;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        email: string;
        role?: Database['public']['Enums']['member_role'];
        token: string;
        invited_by?: string | null;
        expires_at?: string;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        email?: string;
        role?: Database['public']['Enums']['member_role'];
        token?: string;
        invited_by?: string | null;
        expires_at?: string;
        created_at?: string;
      };
      Relationships: [];
    };
    knowledge_documents: {
      Row: {
        id: string;
        organization_id: string;
        collection: string;
        title: string;
        content: string;
        metadata: Json;
        embedding: number[] | null;
        token_count: number;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        collection?: string;
        title: string;
        content: string;
        metadata?: Json;
        embedding?: number[] | null;
        token_count?: number;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        collection?: string;
        title?: string;
        content?: string;
        metadata?: Json;
        embedding?: number[] | null;
        token_count?: number;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    leads: {
      Row: {
        id: string;
        organization_id: string;
        phone: string;
        name: string | null;
        city: string | null;
        interest: string | null;
        urgency: string | null;
        memory: Json;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        phone: string;
        name?: string | null;
        city?: string | null;
        interest?: string | null;
        urgency?: string | null;
        memory?: Json;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        phone?: string;
        name?: string | null;
        city?: string | null;
        interest?: string | null;
        urgency?: string | null;
        memory?: Json;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    messages: {
      Row: {
        id: string;
        organization_id: string;
        connection_id: string;
        conversation_id: string;
        provider_message_id: string | null;
        direction: string;
        sender: string;
        content: string;
        message_type: string;
        created_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        connection_id: string;
        conversation_id: string;
        provider_message_id?: string | null;
        direction: string;
        sender: string;
        content: string;
        message_type?: string;
        created_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        connection_id?: string;
        conversation_id?: string;
        provider_message_id?: string | null;
        direction?: string;
        sender?: string;
        content?: string;
        message_type?: string;
        created_at?: string;
      };
      Relationships: [];
    };
    metrics_daily: {
      Row: {
        id: string;
        organization_id: string;
        metric_date: string;
        flow_id: string | null;
        flow_version_id: string | null;
        total_conversations: number;
        new_conversations: number;
        qualified_conversations: number;
        handoff_conversations: number;
        stage_counts: Json;
        avg_first_response_time_ms: number;
        total_input_tokens: number;
        total_output_tokens: number;
        estimated_token_cost: number;
        created_at: string;
        updated_at: string;
      };
      Insert: {
        id?: string;
        organization_id: string;
        metric_date: string;
        flow_id?: string | null;
        flow_version_id?: string | null;
        total_conversations?: number;
        new_conversations?: number;
        qualified_conversations?: number;
        handoff_conversations?: number;
        stage_counts?: Json;
        avg_first_response_time_ms?: number;
        total_input_tokens?: number;
        total_output_tokens?: number;
        estimated_token_cost?: number;
        created_at?: string;
        updated_at?: string;
      };
      Update: {
        id?: string;
        organization_id?: string;
        metric_date?: string;
        flow_id?: string | null;
        flow_version_id?: string | null;
        total_conversations?: number;
        new_conversations?: number;
        qualified_conversations?: number;
        handoff_conversations?: number;
        stage_counts?: Json;
        avg_first_response_time_ms?: number;
        total_input_tokens?: number;
        total_output_tokens?: number;
        estimated_token_cost?: number;
        created_at?: string;
        updated_at?: string;
      };
      Relationships: [];
    };
    organization_members: {
      Row: {
        organization_id: string;
        user_id: string;
        role: Database['public']['Enums']['member_role'];
        created_at: string;
      };
      Insert: {
        organization_id: string;
        user_id: string;
        role?: Database['public']['Enums']['member_role'];
        created_at?: string;
      };
      Update: {
        organization_id?: string;
        user_id?: string;
        role?: Database['public']['Enums']['member_role'];
        created_at?: string;
      };
      Relationships: [];
    };
    organizations: {
      Row: {
        id: string;
        name: string;
        created_at: string;
      };
      Insert: {
        id?: string;
        name: string;
        created_at?: string;
      };
      Update: {
        id?: string;
        name?: string;
        created_at?: string;
      };
      Relationships: [];
    };
    };
    Views: Record<never, never>;
    Functions: {
      set_connection_credentials: { Args: { p_org: string; p_connection: string; p_ciphertext: string }; Returns: undefined };
      get_connection_credentials: { Args: { p_connection: string }; Returns: string | null };
      create_organization: { Args: { org_name: string }; Returns: string };
      publish_flow: { Args: { p_org: string; p_flow: string; p_actor: string; p_graph: Json }; Returns: Database['public']['Tables']['flow_versions']['Row'] };
      create_invitation: { Args: { p_org: string; p_email: string; p_role: Database['public']['Enums']['member_role']; p_token: string }; Returns: Database['public']['Tables']['invitations']['Row'] };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      match_knowledge: { Args: { p_org: string; p_embedding: number[]; p_collection?: string | null; p_threshold?: number; p_limit?: number }; Returns: { id: string; collection: string; title: string; content: string; metadata: Json; similarity: number }[] };
      rollup_metrics_daily: { Args: { p_org: string; p_target_date: string; p_flow_version?: string | null }; Returns: Database['public']['Tables']['metrics_daily']['Row'] };
    };
    Enums: {
      connection_provider: "evolution" | "meta";
      conversation_stage: "NEW_CONVERSATION" | "QUALIFYING" | "COLLECTING_INFORMATION" | "PRESENTING_SOLUTION" | "NEGOTIATING" | "CONVERTED" | "HUMAN_HANDOFF" | "CLOSED";
      member_role: "owner" | "admin" | "agent" | "viewer";
    };
    CompositeTypes: Record<never, never>;
  };
};
