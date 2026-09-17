import type { FlowContextConversation, FlowContextMessage } from '@sdr/shared';

export interface HandoffResult {
  isHumanTakeover: boolean;
  isAiEcho: boolean;
}

export class HandoffService {
  public static triggerHandoff(
    conversation: FlowContextConversation,
    reason = 'HUMAN_HANDOFF',
    notes?: string
  ): { reason: string; notes?: string } {
    conversation.bot_paused = true;
    conversation.handled_by = 'HUMAN';
    conversation.stage = 'HUMAN_HANDOFF';
    return { reason, notes };
  }

  public static checkOutboundFromMe(
    recentMessages: FlowContextMessage[],
    content: string,
    messageId?: string | null
  ): HandoffResult {
    // recentMessages is ordered newest-first (see webhook.ts query)
    const lastMsg = recentMessages[0];

    if (lastMsg && lastMsg.fromMe) {
      const matchId = Boolean(messageId && lastMsg.id === messageId);
      const matchContent = Boolean(lastMsg.text && lastMsg.text.trim() === (content || '').trim());

      if (matchId || matchContent) {
        return { isHumanTakeover: false, isAiEcho: true };
      }
    }

    // Otherwise, human operator typed directly
    return { isHumanTakeover: true, isAiEcho: false };
  }
}
