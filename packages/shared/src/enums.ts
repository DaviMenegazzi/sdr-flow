export enum ConversationStage {
  // Canonical 8 States (R4)
  NEW_CONVERSATION = "NEW_CONVERSATION",
  QUALIFYING = "QUALIFYING",
  COLLECTING_INFORMATION = "COLLECTING_INFORMATION",
  PRESENTING_SOLUTION = "PRESENTING_SOLUTION",
  NEGOTIATING = "NEGOTIATING",
  CONVERTED = "CONVERTED",
  HUMAN_HANDOFF = "HUMAN_HANDOFF",
  CLOSED = "CLOSED",

  // Backward-compatibility aliases for existing DB rows and legacy tests
  NEW = "NEW_CONVERSATION",
  CONTACT_STARTED = "QUALIFYING",
  DISCOVERY = "COLLECTING_INFORMATION",
  QUALIFIED = "PRESENTING_SOLUTION",
  HANDOFF = "HUMAN_HANDOFF",
  HUMAN = "HUMAN_HANDOFF",
  LOST = "CLOSED",
  NO_RESPONSE = "CLOSED",
  NOT_QUALIFIED = "CLOSED",
  CUSTOMER = "CONVERTED",
}

export const CANONICAL_CONVERSATION_STAGES: ConversationStage[] = [
  ConversationStage.NEW_CONVERSATION,
  ConversationStage.QUALIFYING,
  ConversationStage.COLLECTING_INFORMATION,
  ConversationStage.PRESENTING_SOLUTION,
  ConversationStage.NEGOTIATING,
  ConversationStage.CONVERTED,
  ConversationStage.HUMAN_HANDOFF,
  ConversationStage.CLOSED,
];

export const LEGACY_STAGE_MAP: Record<string, ConversationStage> = {
  NEW: ConversationStage.NEW_CONVERSATION,
  CONTACT_STARTED: ConversationStage.QUALIFYING,
  DISCOVERY: ConversationStage.COLLECTING_INFORMATION,
  QUALIFYING: ConversationStage.QUALIFYING,
  QUALIFIED: ConversationStage.PRESENTING_SOLUTION,
  HANDOFF: ConversationStage.HUMAN_HANDOFF,
  HUMAN: ConversationStage.HUMAN_HANDOFF,
  LOST: ConversationStage.CLOSED,
  NO_RESPONSE: ConversationStage.CLOSED,
  NOT_QUALIFIED: ConversationStage.CLOSED,
  CUSTOMER: ConversationStage.CONVERTED,
};

export function normalizeConversationStage(
  stage: string | ConversationStage | null | undefined
): ConversationStage {
  if (!stage) return ConversationStage.NEW_CONVERSATION;
  const upper = String(stage).trim().toUpperCase();
  if (CANONICAL_CONVERSATION_STAGES.includes(upper as ConversationStage)) {
    return upper as ConversationStage;
  }
  if (LEGACY_STAGE_MAP[upper]) {
    return LEGACY_STAGE_MAP[upper];
  }
  return ConversationStage.NEW_CONVERSATION;
}

export enum QualificationStatus {
  COLLECTING = "COLLECTING",
  HOT = "HOT",
  WARM = "WARM",
  COLD = "COLD",
  DISQUALIFIED = "DISQUALIFIED"
}

export enum MessageDirection {
  INBOUND = "INBOUND",
  OUTBOUND = "OUTBOUND"
}

export enum HandledBy {
  AI = "AI",
  HUMAN = "HUMAN",
  SYSTEM = "SYSTEM"
}

export enum HandoffReason {
  QUALIFIED_LEAD = "qualified_lead",
  BUYING_INTENT_HIGH = "buying_intent_high",
  HUMAN_TAKEOVER = "human_takeover",
  COMPLEX_QUERY = "complex_query",
  USER_REQUEST = "user_request",
  SCORE_THRESHOLD = "score_threshold"
}

export enum DealStatus {
  OPEN = "OPEN",
  WON = "WON",
  LOST = "LOST"
}

export enum TaskStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED"
}

export enum UserRole {
  ADMIN = "ADMIN",
  AGENT = "AGENT",
  VIEWER = "VIEWER"
}

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  LOGIN = "LOGIN",
  HANDOFF = "HANDOFF",
  CONFIG_CHANGE = "CONFIG_CHANGE",
  PAUSE = "PAUSE",
  RESUME = "RESUME",
  WEBHOOK_DISPATCH = "WEBHOOK_DISPATCH"
}
