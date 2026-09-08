import type { FlowContextLead, FlowContextConversation } from '@sdr/shared';
import type { LLMProvider } from './llm.js';

export interface MessagingService {
  sendText(connectionId: string, phone: string, text: string, options?: { typing?: boolean }): Promise<{ messageId: string }>;
  sendMedia(connectionId: string, phone: string, url: string, mediaType: string, caption?: string): Promise<{ messageId: string }>;
  sendTemplate(connectionId: string, phone: string, name: string, language: string): Promise<{ messageId: string }>;
}

export interface MediaService {
  transcribeAudio(url: string): Promise<string>;
  describeImage(url: string): Promise<string>;
}

export interface DatabaseService {
  updateLead(organizationId: string, leadId: string, data: Partial<FlowContextLead>): Promise<void>;
  updateConversation(organizationId: string, conversationId: string, data: Partial<FlowContextConversation>): Promise<void>;
  saveMessage(organizationId: string, connectionId: string, conversationId: string, msg: {
    sender: 'lead' | 'ai' | 'human' | 'system';
    direction: 'INBOUND' | 'OUTBOUND';
    content: string;
    messageType?: string;
    providerMessageId?: string;
  }): Promise<{ id: string }>;
  syncDeal(organizationId: string, leadId: string, deal: { title: string; status: 'OPEN' | 'WON' | 'LOST'; score?: number }): Promise<{ id: string }>;
  searchKnowledge?(organizationId: string, collection: string, query: string, limit: number, threshold: number): Promise<string[]>;
  getConversationSummary?(organizationId: string, conversationId: string): Promise<string | null>;
  saveConversationSummary?(organizationId: string, conversationId: string, summary: string, messageCount: number, tokensUsed: number): Promise<void>;
}

export interface FlowServices {
  llm: LLMProvider;
  messaging: MessagingService;
  media?: MediaService;
  db?: DatabaseService;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}
