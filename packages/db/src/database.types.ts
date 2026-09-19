export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_limits: {
        Row: {
          created_at: string
          max_agents: number
          max_instances: number | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          max_agents?: number
          max_instances?: number | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          max_agents?: number
          max_instances?: number | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_agents: {
        Row: {
          active_flow_version_id: string | null
          created_at: string
          description: string | null
          flow_id: string | null
          id: string
          is_default: boolean
          model: string
          model_config: Json
          name: string
          organization_id: string
          owner_user_id: string
          provider: string
          status: Database["public"]["Enums"]["agent_status"]
          system_prompt: string
          tool_policy: Json
          updated_at: string
        }
        Insert: {
          active_flow_version_id?: string | null
          created_at?: string
          description?: string | null
          flow_id?: string | null
          id?: string
          is_default?: boolean
          model: string
          model_config?: Json
          name: string
          organization_id: string
          owner_user_id: string
          provider: string
          status?: Database["public"]["Enums"]["agent_status"]
          system_prompt?: string
          tool_policy?: Json
          updated_at?: string
        }
        Update: {
          active_flow_version_id?: string | null
          created_at?: string
          description?: string | null
          flow_id?: string | null
          id?: string
          is_default?: boolean
          model?: string
          model_config?: Json
          name?: string
          organization_id?: string
          owner_user_id?: string
          provider?: string
          status?: Database["public"]["Enums"]["agent_status"]
          system_prompt?: string
          tool_policy?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_organization_id_flow_id_active_flow_version_id_fkey"
            columns: ["organization_id", "flow_id", "active_flow_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["organization_id", "flow_id", "id"]
          },
          {
            foreignKeyName: "ai_agents_organization_id_flow_id_fkey"
            columns: ["organization_id", "flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_agents_organization_id_owner_user_id_fkey"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          role?: Database["public"]["Enums"]["member_role"]
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          id: string
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_accounts: {
        Row: {
          account_email: string
          account_name: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          account_email: string
          account_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_email?: string
          account_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          name: string
          organization_id: string
          owner_user_id: string
          phone: string | null
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_instance_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          owner_user_id: string
          phone?: string | null
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_instance_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          owner_user_id?: string
          phone?: string | null
          provider?: Database["public"]["Enums"]["connection_provider"]
          provider_instance_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_owner_agent_fk"
            columns: ["organization_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "connections_owner_member_fk"
            columns: ["organization_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          last_message_id: string | null
          messages_count: number
          organization_id: string
          summary: string
          tokens_used: number
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          last_message_id?: string | null
          messages_count?: number
          organization_id: string
          summary: string
          tokens_used?: number
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          last_message_id?: string | null
          messages_count?: number
          organization_id?: string
          summary?: string
          tokens_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_last_message_id_fkey"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_user_id: string | null
          bot_paused: boolean
          connection_id: string
          created_at: string
          flow_version_id: string | null
          handled_by: string
          id: string
          last_message_at: string | null
          lead_id: string
          organization_id: string
          stage: Database["public"]["Enums"]["conversation_stage"]
          stage_updated_at: string
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          bot_paused?: boolean
          connection_id: string
          created_at?: string
          flow_version_id?: string | null
          handled_by?: string
          id?: string
          last_message_at?: string | null
          lead_id: string
          organization_id: string
          stage?: Database["public"]["Enums"]["conversation_stage"]
          stage_updated_at?: string
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          bot_paused?: boolean
          connection_id?: string
          created_at?: string
          flow_version_id?: string | null
          handled_by?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string
          organization_id?: string
          stage?: Database["public"]["Enums"]["conversation_stage"]
          stage_updated_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_organization_id_assigned_user_id_fkey"
            columns: ["organization_id", "assigned_user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "conversations_organization_id_connection_id_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_organization_id_flow_version_id_fkey"
            columns: ["organization_id", "flow_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_organization_id_lead_id_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      deals: {
        Row: {
          connection_id: string | null
          created_at: string
          id: string
          lead_id: string
          organization_id: string
          owner_user_id: string | null
          score: number | null
          status: string
          title: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          organization_id: string
          owner_user_id?: string | null
          score?: number | null
          status?: string
          title: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          organization_id?: string
          owner_user_id?: string | null
          score?: number | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_instance_lead_fk"
            columns: [
              "organization_id",
              "owner_user_id",
              "connection_id",
              "lead_id",
            ]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: [
              "organization_id",
              "owner_user_id",
              "connection_id",
              "id",
            ]
          },
          {
            foreignKeyName: "deals_organization_id_lead_id_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      evolution_ai_automation_settings: {
        Row: {
          automation_key: string
          enabled: boolean
          last_completed_at: string | null
          last_run_status: string | null
          last_run_summary: Json | null
          last_started_at: string | null
          min_confidence: number
          schedule_cron_task_uid: string | null
          updated_at: string
        }
        Insert: {
          automation_key: string
          enabled?: boolean
          last_completed_at?: string | null
          last_run_status?: string | null
          last_run_summary?: Json | null
          last_started_at?: string | null
          min_confidence?: number
          schedule_cron_task_uid?: string | null
          updated_at?: string
        }
        Update: {
          automation_key?: string
          enabled?: boolean
          last_completed_at?: string | null
          last_run_status?: string | null
          last_run_summary?: Json | null
          last_started_at?: string | null
          min_confidence?: number
          schedule_cron_task_uid?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      evolution_ai_classification_runs: {
        Row: {
          applied_stage: string | null
          completed_at: string
          confidence: number | null
          created_at: string
          error_message: string | null
          execution_key: string
          id: string
          instance_name: string
          lead_id: string
          model: string
          previous_stage: string
          proposed_stage: string | null
          rationale: string | null
          source_last_message_at: string
          source_message_count: number
          status: string
        }
        Insert: {
          applied_stage?: string | null
          completed_at?: string
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          execution_key: string
          id?: string
          instance_name: string
          lead_id: string
          model: string
          previous_stage: string
          proposed_stage?: string | null
          rationale?: string | null
          source_last_message_at: string
          source_message_count: number
          status: string
        }
        Update: {
          applied_stage?: string | null
          completed_at?: string
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          execution_key?: string
          id?: string
          instance_name?: string
          lead_id?: string
          model?: string
          previous_stage?: string
          proposed_stage?: string | null
          rationale?: string | null
          source_last_message_at?: string
          source_message_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_ai_classification_runs_instance_name_fkey"
            columns: ["instance_name"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["instance_name"]
          },
          {
            foreignKeyName: "evolution_ai_classification_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "evolution_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_crm_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage: string | null
          id: string
          instance_name: string
          lead_id: string
          note: string | null
          to_stage: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          instance_name: string
          lead_id: string
          note?: string | null
          to_stage: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          instance_name?: string
          lead_id?: string
          note?: string | null
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_crm_stage_history_instance_name_fkey"
            columns: ["instance_name"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["instance_name"]
          },
          {
            foreignKeyName: "evolution_crm_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "evolution_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_events: {
        Row: {
          attribution_payload_json: Json | null
          direction: string
          event_fingerprint: string
          event_type: string
          google_click_id: string | null
          id: string
          instance_name: string
          message_body: string | null
          message_id: string | null
          message_preview: string | null
          message_type: string | null
          meta_ctwa_clid: string | null
          meta_source_id: string | null
          meta_source_type: string | null
          occurred_at: string | null
          origin_evidence: string
          origin_platform: string
          received_at: string
          remote_jid: string | null
        }
        Insert: {
          attribution_payload_json?: Json | null
          direction: string
          event_fingerprint: string
          event_type: string
          google_click_id?: string | null
          id?: string
          instance_name: string
          message_body?: string | null
          message_id?: string | null
          message_preview?: string | null
          message_type?: string | null
          meta_ctwa_clid?: string | null
          meta_source_id?: string | null
          meta_source_type?: string | null
          occurred_at?: string | null
          origin_evidence?: string
          origin_platform?: string
          received_at?: string
          remote_jid?: string | null
        }
        Update: {
          attribution_payload_json?: Json | null
          direction?: string
          event_fingerprint?: string
          event_type?: string
          google_click_id?: string | null
          id?: string
          instance_name?: string
          message_body?: string | null
          message_id?: string | null
          message_preview?: string | null
          message_type?: string | null
          meta_ctwa_clid?: string | null
          meta_source_id?: string | null
          meta_source_type?: string | null
          occurred_at?: string | null
          origin_evidence?: string
          origin_platform?: string
          received_at?: string
          remote_jid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_events_instance_name_fkey"
            columns: ["instance_name"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["instance_name"]
          },
        ]
      }
      evolution_instances: {
        Row: {
          connection_status: string
          created_at: string
          display_name: string | null
          instance_name: string
          last_event_at: string | null
          last_message_at: string | null
          unit_name: string | null
          updated_at: string
        }
        Insert: {
          connection_status?: string
          created_at?: string
          display_name?: string | null
          instance_name: string
          last_event_at?: string | null
          last_message_at?: string | null
          unit_name?: string | null
          updated_at?: string
        }
        Update: {
          connection_status?: string
          created_at?: string
          display_name?: string | null
          instance_name?: string
          last_event_at?: string | null
          last_message_at?: string | null
          unit_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      evolution_leads: {
        Row: {
          classification: string
          classification_note: string | null
          classified_at: string | null
          classified_by_email: string | null
          contact_key: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          crm_stage: string
          crm_stage_updated_at: string
          crm_stage_updated_by: string | null
          first_contact_at: string
          funnel_stage: string
          google_click_id: string | null
          id: string
          instance_name: string
          last_event_id: string | null
          last_message_at: string
          messages_received: number
          messages_sent: number
          meta_ctwa_clid: string | null
          origin_detected_at: string | null
          origin_evidence: string
          origin_platform: string
          phone_last4: string | null
          updated_at: string
        }
        Insert: {
          classification?: string
          classification_note?: string | null
          classified_at?: string | null
          classified_by_email?: string | null
          contact_key: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_stage?: string
          crm_stage_updated_at?: string
          crm_stage_updated_by?: string | null
          first_contact_at: string
          funnel_stage?: string
          google_click_id?: string | null
          id?: string
          instance_name: string
          last_event_id?: string | null
          last_message_at: string
          messages_received?: number
          messages_sent?: number
          meta_ctwa_clid?: string | null
          origin_detected_at?: string | null
          origin_evidence?: string
          origin_platform?: string
          phone_last4?: string | null
          updated_at?: string
        }
        Update: {
          classification?: string
          classification_note?: string | null
          classified_at?: string | null
          classified_by_email?: string | null
          contact_key?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          crm_stage?: string
          crm_stage_updated_at?: string
          crm_stage_updated_by?: string | null
          first_contact_at?: string
          funnel_stage?: string
          google_click_id?: string | null
          id?: string
          instance_name?: string
          last_event_id?: string | null
          last_message_at?: string
          messages_received?: number
          messages_sent?: number
          meta_ctwa_clid?: string | null
          origin_detected_at?: string | null
          origin_evidence?: string
          origin_platform?: string
          phone_last4?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_leads_instance_name_fkey"
            columns: ["instance_name"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["instance_name"]
          },
          {
            foreignKeyName: "evolution_leads_last_event_id_fkey"
            columns: ["last_event_id"]
            isOneToOne: false
            referencedRelation: "evolution_events"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_messages: {
        Row: {
          body_text: string | null
          contact_key: string
          direction: string
          event_id: string
          id: string
          instance_name: string
          lead_id: string
          message_type: string | null
          received_at: string
          sent_at: string
        }
        Insert: {
          body_text?: string | null
          contact_key: string
          direction: string
          event_id: string
          id?: string
          instance_name: string
          lead_id: string
          message_type?: string | null
          received_at?: string
          sent_at: string
        }
        Update: {
          body_text?: string | null
          contact_key?: string
          direction?: string
          event_id?: string
          id?: string
          instance_name?: string
          lead_id?: string
          message_type?: string | null
          received_at?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "evolution_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_messages_instance_name_fkey"
            columns: ["instance_name"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["instance_name"]
          },
          {
            foreignKeyName: "evolution_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "evolution_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_meta_attributions: {
        Row: {
          account_id: string | null
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          client_id: string | null
          creative_id: string | null
          creative_name: string | null
          id: string
          lead_id: string
          match_status: string
          matched_at: string
          matched_by: string
          source_event_id: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          client_id?: string | null
          creative_id?: string | null
          creative_name?: string | null
          id?: string
          lead_id: string
          match_status: string
          matched_at?: string
          matched_by: string
          source_event_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          client_id?: string | null
          creative_id?: string | null
          creative_name?: string | null
          id?: string
          lead_id?: string
          match_status?: string
          matched_at?: string
          matched_by?: string
          source_event_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_meta_attributions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "evolution_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_meta_attributions_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "evolution_events"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_execution_steps: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          execution_id: string
          id: string
          input: Json | null
          node_id: string
          organization_id: string
          output: Json | null
          sequence: number
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          execution_id: string
          id?: string
          input?: Json | null
          node_id: string
          organization_id: string
          output?: Json | null
          sequence: number
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          execution_id?: string
          id?: string
          input?: Json | null
          node_id?: string
          organization_id?: string
          output?: Json | null
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "flow_execution_steps_organization_id_execution_id_fkey"
            columns: ["organization_id", "execution_id"]
            isOneToOne: false
            referencedRelation: "flow_executions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      flow_executions: {
        Row: {
          agent_id: string | null
          connection_id: string | null
          conversation_id: string
          created_at: string
          finished_at: string | null
          flow_version_id: string
          id: string
          idempotency_key: string | null
          input_tokens: number
          lead_id: string | null
          model: string | null
          organization_id: string
          output_tokens: number
          resume_node_id: string | null
          status: string
          trace_status: string
        }
        Insert: {
          agent_id?: string | null
          connection_id?: string | null
          conversation_id: string
          created_at?: string
          finished_at?: string | null
          flow_version_id: string
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          lead_id?: string | null
          model?: string | null
          organization_id: string
          output_tokens?: number
          resume_node_id?: string | null
          status?: string
          trace_status?: string
        }
        Update: {
          agent_id?: string | null
          connection_id?: string | null
          conversation_id?: string
          created_at?: string
          finished_at?: string | null
          flow_version_id?: string
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          lead_id?: string | null
          model?: string | null
          organization_id?: string
          output_tokens?: number
          resume_node_id?: string | null
          status?: string
          trace_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_executions_agent_fk"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_executions_connection_fk"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "flow_executions_lead_fk"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "flow_executions_organization_id_conversation_id_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "flow_executions_organization_id_flow_version_id_fkey"
            columns: ["organization_id", "flow_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      flow_versions: {
        Row: {
          created_at: string
          created_by: string | null
          flow_id: string
          graph: Json
          id: string
          organization_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          flow_id: string
          graph: Json
          id?: string
          organization_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          flow_id?: string
          graph?: Json
          id?: string
          organization_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "flow_versions_organization_id_flow_id_fkey"
            columns: ["organization_id", "flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          draft: Json
          id: string
          name: string
          organization_id: string
          published_version_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft: Json
          id?: string
          name: string
          organization_id: string
          published_version_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          id?: string
          name?: string
          organization_id?: string
          published_version_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flows_published_version_fk"
            columns: ["organization_id", "id", "published_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["organization_id", "flow_id", "id"]
          },
        ]
      }
      inbound_events: {
        Row: {
          attempt_count: number
          available_at: string
          connection_id: string
          conversation_key: string
          created_at: string
          id: string
          last_error: string | null
          normalized_payload: Json
          organization_id: string
          processed_at: string | null
          processing_started_at: string | null
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_message_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          connection_id: string
          conversation_key: string
          created_at?: string
          id?: string
          last_error?: string | null
          normalized_payload: Json
          organization_id: string
          processed_at?: string | null
          processing_started_at?: string | null
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_message_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          connection_id?: string
          conversation_key?: string
          created_at?: string
          id?: string
          last_error?: string | null
          normalized_payload?: Json
          organization_id?: string
          processed_at?: string | null
          processing_started_at?: string | null
          provider?: Database["public"]["Enums"]["connection_provider"]
          provider_message_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_events_organization_id_connection_id_fkey"
            columns: ["organization_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["member_role"]
          token: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          collection: string
          connection_id: string | null
          content: string
          created_at: string
          embedding: number[] | null
          id: string
          metadata: Json
          organization_id: string
          owner_user_id: string | null
          title: string
          token_count: number
          updated_at: string
        }
        Insert: {
          collection?: string
          connection_id?: string | null
          content: string
          created_at?: string
          embedding?: number[] | null
          id?: string
          metadata?: Json
          organization_id: string
          owner_user_id?: string | null
          title: string
          token_count?: number
          updated_at?: string
        }
        Update: {
          collection?: string
          connection_id?: string | null
          content?: string
          created_at?: string
          embedding?: number[] | null
          id?: string
          metadata?: Json
          organization_id?: string
          owner_user_id?: string | null
          title?: string
          token_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_instance_fk"
            columns: ["organization_id", "owner_user_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["organization_id", "owner_user_id", "id"]
          },
        ]
      }
      leads: {
        Row: {
          city: string | null
          connection_id: string | null
          created_at: string
          group_subject: string | null
          group_subject_synced_at: string | null
          id: string
          interest: string | null
          is_group: boolean
          memory: Json
          name: string | null
          organization_id: string
          owner_user_id: string | null
          phone: string
          updated_at: string
          urgency: string | null
        }
        Insert: {
          city?: string | null
          connection_id?: string | null
          created_at?: string
          group_subject?: string | null
          group_subject_synced_at?: string | null
          id?: string
          interest?: string | null
          is_group?: boolean
          memory?: Json
          name?: string | null
          organization_id: string
          owner_user_id?: string | null
          phone: string
          updated_at?: string
          urgency?: string | null
        }
        Update: {
          city?: string | null
          connection_id?: string | null
          created_at?: string
          group_subject?: string | null
          group_subject_synced_at?: string | null
          id?: string
          interest?: string | null
          is_group?: boolean
          memory?: Json
          name?: string | null
          organization_id?: string
          owner_user_id?: string | null
          phone?: string
          updated_at?: string
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_connection_owner_fk"
            columns: ["organization_id", "owner_user_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["organization_id", "owner_user_id", "id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          connection_id: string
          content: string
          conversation_id: string
          created_at: string
          direction: string
          id: string
          message_type: string
          organization_id: string
          provider_message_id: string | null
          sender: string
          sender_jid: string | null
          sender_name: string | null
        }
        Insert: {
          connection_id: string
          content: string
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          message_type?: string
          organization_id: string
          provider_message_id?: string | null
          sender: string
          sender_jid?: string | null
          sender_name?: string | null
        }
        Update: {
          connection_id?: string
          content?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          message_type?: string
          organization_id?: string
          provider_message_id?: string | null
          sender?: string
          sender_jid?: string | null
          sender_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_organization_id_connection_id_conversation_id_fkey"
            columns: ["organization_id", "connection_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "connection_id", "id"]
          },
        ]
      }
      metrics_daily: {
        Row: {
          avg_first_response_time_ms: number
          created_at: string
          estimated_token_cost: number
          flow_id: string | null
          flow_version_id: string | null
          handoff_conversations: number
          id: string
          metric_date: string
          new_conversations: number
          organization_id: string
          qualified_conversations: number
          stage_counts: Json
          total_conversations: number
          total_input_tokens: number
          total_output_tokens: number
          updated_at: string
        }
        Insert: {
          avg_first_response_time_ms?: number
          created_at?: string
          estimated_token_cost?: number
          flow_id?: string | null
          flow_version_id?: string | null
          handoff_conversations?: number
          id?: string
          metric_date: string
          new_conversations?: number
          organization_id: string
          qualified_conversations?: number
          stage_counts?: Json
          total_conversations?: number
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
        }
        Update: {
          avg_first_response_time_ms?: number
          created_at?: string
          estimated_token_cost?: number
          flow_id?: string | null
          flow_version_id?: string | null
          handoff_conversations?: number
          id?: string
          metric_date?: string
          new_conversations?: number
          organization_id?: string
          qualified_conversations?: number
          stage_counts?: Json
          total_conversations?: number
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metrics_daily_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_daily_flow_version_id_fkey"
            columns: ["flow_version_id"]
            isOneToOne: false
            referencedRelation: "flow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          tier: Database["public"]["Enums"]["org_tier"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          tier?: Database["public"]["Enums"]["org_tier"]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          tier?: Database["public"]["Enums"]["org_tier"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          default_organization_id: string | null
          display_name: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_organization_id?: string | null
          display_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_organization_id?: string | null
          display_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["account_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_organization_id_fkey"
            columns: ["default_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_form_fields: {
        Row: {
          created_at: string
          field_key: string
          field_type: string
          form_id: string
          help_text: string | null
          id: string
          is_required: boolean
          label: string
          options: Json
          order_index: number
          placeholder: string | null
          validation_rules: Json
        }
        Insert: {
          created_at?: string
          field_key: string
          field_type: string
          form_id: string
          help_text?: string | null
          id?: string
          is_required?: boolean
          label: string
          options?: Json
          order_index?: number
          placeholder?: string | null
          validation_rules?: Json
        }
        Update: {
          created_at?: string
          field_key?: string
          field_type?: string
          form_id?: string
          help_text?: string | null
          id?: string
          is_required?: boolean
          label?: string
          options?: Json
          order_index?: number
          placeholder?: string | null
          validation_rules?: Json
        }
        Relationships: [
          {
            foreignKeyName: "talent_form_fields_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "talent_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      talent_forms: {
        Row: {
          banner_url: string | null
          client_id: string
          created_at: string
          id: string
          is_published: boolean
          lgpd_disclaimer: string
          public_slug: string
          subtitle: string
          success_message: string
          success_title: string
          title: string
          updated_at: string
        }
        Insert: {
          banner_url?: string | null
          client_id: string
          created_at?: string
          id?: string
          is_published?: boolean
          lgpd_disclaimer?: string
          public_slug: string
          subtitle?: string
          success_message?: string
          success_title?: string
          title?: string
          updated_at?: string
        }
        Update: {
          banner_url?: string | null
          client_id?: string
          created_at?: string
          id?: string
          is_published?: boolean
          lgpd_disclaimer?: string
          public_slug?: string
          subtitle?: string
          success_message?: string
          success_title?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      talent_submissions: {
        Row: {
          answers: Json
          candidate_email: string | null
          candidate_name: string | null
          candidate_phone: string | null
          client_id: string
          consent_version: string
          created_at: string
          file_attachments: Json
          form_id: string
          id: string
          ip_hash: string | null
          lgpd_accepted_at: string
          notes: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          answers?: Json
          candidate_email?: string | null
          candidate_name?: string | null
          candidate_phone?: string | null
          client_id: string
          consent_version?: string
          created_at?: string
          file_attachments?: Json
          form_id: string
          id?: string
          ip_hash?: string | null
          lgpd_accepted_at: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          answers?: Json
          candidate_email?: string | null
          candidate_name?: string | null
          candidate_phone?: string | null
          client_id?: string
          consent_version?: string
          created_at?: string
          file_attachments?: Json
          form_id?: string
          id?: string
          ip_hash?: string | null
          lgpd_accepted_at?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "talent_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "talent_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          bot_enabled: boolean | null
          created_at: string
          evolution_api_key: string | null
          evolution_instance_name: string | null
          evolution_server_url: string | null
          id: string
          meta_access_token: string | null
          meta_app_secret: string | null
          meta_phone_number_id: string | null
          meta_verify_token: string | null
          meta_waba_id: string | null
          name: string
          phone_number: string | null
          profile_name: string | null
          profile_pic_url: string | null
          provider: Database["public"]["Enums"]["whatsapp_provider_type"]
          status: string
          test_mode: boolean | null
          test_phone_number: string | null
          updated_at: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          bot_enabled?: boolean | null
          created_at?: string
          evolution_api_key?: string | null
          evolution_instance_name?: string | null
          evolution_server_url?: string | null
          id?: string
          meta_access_token?: string | null
          meta_app_secret?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          meta_waba_id?: string | null
          name: string
          phone_number?: string | null
          profile_name?: string | null
          profile_pic_url?: string | null
          provider?: Database["public"]["Enums"]["whatsapp_provider_type"]
          status?: string
          test_mode?: boolean | null
          test_phone_number?: string | null
          updated_at?: string
          user_id: string
          webhook_url?: string | null
        }
        Update: {
          bot_enabled?: boolean | null
          created_at?: string
          evolution_api_key?: string | null
          evolution_instance_name?: string | null
          evolution_server_url?: string | null
          id?: string
          meta_access_token?: string | null
          meta_app_secret?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          meta_waba_id?: string | null
          name?: string
          phone_number?: string | null
          profile_name?: string | null
          profile_pic_url?: string | null
          provider?: Database["public"]["Enums"]["whatsapp_provider_type"]
          status?: string
          test_mode?: boolean | null
          test_phone_number?: string | null
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_inbound_event: {
        Args: {
          p_connection_id: string
          p_conversation_key: string
          p_normalized_payload: Json
          p_provider: Database["public"]["Enums"]["connection_provider"]
          p_provider_message_id: string
        }
        Returns: {
          event_id: string
          is_new: boolean
          organization_id: string
          status: string
        }[]
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      admin_list_accounts: {
        Args: never
        Returns: {
          display_name: string
          max_agents: number
          max_instances: number
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["account_status"]
          user_id: string
        }[]
      }
      admin_update_account_limits: {
        Args: { p_max_agents: number; p_max_instances: number; p_user: string }
        Returns: {
          created_at: string
          max_agents: number
          max_instances: number | null
          organization_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "account_limits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_account_status: {
        Args: {
          p_status: Database["public"]["Enums"]["account_status"]
          p_user: string
        }
        Returns: {
          created_at: string
          default_organization_id: string | null
          display_name: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["account_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      agent_has_openai_key: { Args: { p_agent: string }; Returns: boolean }
      archive_agent_for_current_user: {
        Args: { p_agent: string }
        Returns: {
          active_flow_version_id: string | null
          created_at: string
          description: string | null
          flow_id: string | null
          id: string
          is_default: boolean
          model: string
          model_config: Json
          name: string
          organization_id: string
          owner_user_id: string
          provider: string
          status: Database["public"]["Enums"]["agent_status"]
          system_prompt: string
          tool_policy: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_agents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_agent_to_connection: {
        Args: { p_agent: string; p_connection: string }
        Returns: {
          agent_id: string
          created_at: string
          id: string
          name: string
          organization_id: string
          owner_user_id: string
          phone: string | null
          provider: Database["public"]["Enums"]["connection_provider"]
          provider_instance_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      backfill_group_inbox: {
        Args: { p_organization_id?: string }
        Returns: {
          leads_marked_group: number
          messages_sender_backfilled: number
        }[]
      }
      cosine_similarity: { Args: { a: number[]; b: number[] }; Returns: number }
      create_agent_for_current_user: {
        Args: {
          p_description: string
          p_model: string
          p_model_config?: Json
          p_name: string
          p_provider: string
          p_system_prompt: string
          p_tool_policy?: Json
        }
        Returns: {
          active_flow_version_id: string | null
          created_at: string
          description: string | null
          flow_id: string | null
          id: string
          is_default: boolean
          model: string
          model_config: Json
          name: string
          organization_id: string
          owner_user_id: string
          provider: string
          status: Database["public"]["Enums"]["agent_status"]
          system_prompt: string
          tool_policy: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_agents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invitation: {
        Args: {
          p_email: string
          p_org: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_token: string
        }
        Returns: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_oauth_state: {
        Args: {
          p_org: string
          p_provider: string
          p_redirect_url?: string
          p_state: string
          p_user: string
        }
        Returns: undefined
      }
      create_organization: { Args: { org_name: string }; Returns: string }
      find_or_create_lead: {
        Args: {
          p_connection_id: string
          p_name: string
          p_organization_id: string
          p_phone: string
        }
        Returns: {
          city: string | null
          connection_id: string | null
          created_at: string
          group_subject: string | null
          group_subject_synced_at: string | null
          id: string
          interest: string | null
          is_group: boolean
          memory: Json
          name: string | null
          organization_id: string
          owner_user_id: string | null
          phone: string
          updated_at: string
          urgency: string | null
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_agent_openai_key: { Args: { p_agent: string }; Returns: string }
      get_calendar_credentials: { Args: { p_account: string }; Returns: string }
      get_connection_credentials: {
        Args: { p_connection: string }
        Returns: string
      }
      get_dashboard_metrics: {
        Args: {
          p_connection_id?: string
          p_end_date: string
          p_organization_id: string
          p_start_date: string
        }
        Returns: Json
      }
      get_thread_messages: {
        Args: {
          p_conversation_id: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: {
          connection_id: string
          content: string
          conversation_id: string
          created_at: string
          direction: string
          id: string
          message_type: string
          organization_id: string
          provider_message_id: string | null
          sender: string
          sender_jid: string | null
          sender_name: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_inbox_threads: {
        Args: {
          p_assigned_user_id?: string
          p_connection_id?: string
          p_handled_by?: string
          p_limit?: number
          p_offset?: number
          p_organization_id: string
          p_search?: string
          p_stage?: string
          p_unassigned?: boolean
        }
        Returns: {
          id: string
          total_count: number
        }[]
      }
      mark_inbound_event_status: {
        Args: {
          p_error?: string
          p_event_id: string
          p_organization_id: string
          p_status: string
        }
        Returns: undefined
      }
      match_knowledge: {
        Args: {
          p_collection?: string
          p_embedding: number[]
          p_limit?: number
          p_org: string
          p_threshold?: number
        }
        Returns: {
          collection: string
          content: string
          id: string
          metadata: Json
          similarity: number
          title: string
        }[]
      }
      move_evolution_lead_stage: {
        Args: {
          p_changed_by: string
          p_instance_name: string
          p_lead_id: string
          p_note?: string
          p_to_stage: string
        }
        Returns: {
          crm_stage: string
          crm_stage_updated_at: string
          lead_id: string
        }[]
      }
      publish_flow: {
        Args: { p_actor: string; p_flow: string; p_graph: Json; p_org: string }
        Returns: {
          created_at: string
          created_by: string | null
          flow_id: string
          graph: Json
          id: string
          organization_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "flow_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_evolution_event:
        | {
            Args: {
              p_attribution_payload_json: Json
              p_connection_status: string
              p_contact_key: string
              p_contact_name: string
              p_direction: string
              p_event_fingerprint: string
              p_event_type: string
              p_google_click_id: string
              p_instance_name: string
              p_message_id: string
              p_message_preview: string
              p_message_type: string
              p_meta_ctwa_clid: string
              p_meta_source_id: string
              p_meta_source_type: string
              p_occurred_at: string
              p_origin_evidence: string
              p_origin_platform: string
              p_phone_last4: string
              p_remote_jid: string
            }
            Returns: {
              duplicate: boolean
              event_id: string
            }[]
          }
        | {
            Args: {
              p_attribution_payload_json: Json
              p_connection_status: string
              p_contact_key: string
              p_contact_name: string
              p_direction: string
              p_event_fingerprint: string
              p_event_type: string
              p_google_click_id: string
              p_instance_name: string
              p_message_body: string
              p_message_id: string
              p_message_preview: string
              p_message_type: string
              p_meta_ctwa_clid: string
              p_meta_source_id: string
              p_meta_source_type: string
              p_occurred_at: string
              p_origin_evidence: string
              p_origin_platform: string
              p_phone_last4: string
              p_remote_jid: string
            }
            Returns: {
              duplicate: boolean
              event_id: string
            }[]
          }
      rollup_metrics_daily: {
        Args: { p_flow_version?: string; p_org: string; p_target_date: string }
        Returns: {
          avg_first_response_time_ms: number
          created_at: string
          estimated_token_cost: number
          flow_id: string | null
          flow_version_id: string | null
          handoff_conversations: number
          id: string
          metric_date: string
          new_conversations: number
          organization_id: string
          qualified_conversations: number
          stage_counts: Json
          total_conversations: number
          total_input_tokens: number
          total_output_tokens: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "metrics_daily"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_inbound_message: {
        Args: {
          p_connection_id: string
          p_content: string
          p_conversation_id: string
          p_direction: string
          p_message_type: string
          p_organization_id: string
          p_provider_message_id: string
          p_sender: string
        }
        Returns: {
          created_at: string
          id: string
          is_new: boolean
        }[]
      }
      set_agent_openai_key: {
        Args: {
          p_agent: string
          p_ciphertext: string
          p_org: string
          p_owner: string
        }
        Returns: undefined
      }
      set_calendar_credentials: {
        Args: { p_account: string; p_ciphertext: string; p_org: string }
        Returns: undefined
      }
      set_connection_credentials: {
        Args: { p_ciphertext: string; p_connection: string; p_org: string }
        Returns: undefined
      }
      update_agent_for_current_user: {
        Args: {
          p_agent: string
          p_description: string
          p_model: string
          p_model_config: Json
          p_name: string
          p_provider: string
          p_system_prompt: string
          p_tool_policy: Json
        }
        Returns: {
          active_flow_version_id: string | null
          created_at: string
          description: string | null
          flow_id: string | null
          id: string
          is_default: boolean
          model: string
          model_config: Json
          name: string
          organization_id: string
          owner_user_id: string
          provider: string
          status: Database["public"]["Enums"]["agent_status"]
          system_prompt: string
          tool_policy: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_agents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_and_consume_oauth_state: {
        Args: { p_state: string }
        Returns: {
          organization_id: string
          provider: string
          redirect_url: string
          user_id: string
        }[]
      }
    }
    Enums: {
      account_status: "invited" | "active" | "suspended" | "disabled"
      agent_status: "active" | "archived"
      app_role: "admin" | "client"
      connection_provider: "evolution" | "meta"
      conversation_stage:
        | "NEW_CONVERSATION"
        | "QUALIFYING"
        | "COLLECTING_INFORMATION"
        | "PRESENTING_SOLUTION"
        | "NEGOTIATING"
        | "CONVERTED"
        | "HUMAN_HANDOFF"
        | "CLOSED"
      member_role: "owner" | "admin" | "agent" | "viewer"
      org_tier: "pre-venda" | "vendedor" | "vendedor-senior"
      whatsapp_provider_type: "EVOLUTION" | "META_CLOUD"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["invited", "active", "suspended", "disabled"],
      agent_status: ["active", "archived"],
      app_role: ["admin", "client"],
      connection_provider: ["evolution", "meta"],
      conversation_stage: [
        "NEW_CONVERSATION",
        "QUALIFYING",
        "COLLECTING_INFORMATION",
        "PRESENTING_SOLUTION",
        "NEGOTIATING",
        "CONVERTED",
        "HUMAN_HANDOFF",
        "CLOSED",
      ],
      member_role: ["owner", "admin", "agent", "viewer"],
      org_tier: ["pre-venda", "vendedor", "vendedor-senior"],
      whatsapp_provider_type: ["EVOLUTION", "META_CLOUD"],
    },
  },
} as const
