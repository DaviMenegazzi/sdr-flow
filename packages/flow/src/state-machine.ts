import {
  ConversationStage,
  CANONICAL_CONVERSATION_STAGES,
  normalizeConversationStage,
} from "@sdr/shared";

export const STAGE_TRANSITIONS: Record<ConversationStage, ConversationStage[]> = {
  [ConversationStage.NEW_CONVERSATION]: [
    ConversationStage.QUALIFYING,
    ConversationStage.HUMAN_HANDOFF,
    ConversationStage.CLOSED,
  ],
  [ConversationStage.QUALIFYING]: [
    ConversationStage.COLLECTING_INFORMATION,
    ConversationStage.HUMAN_HANDOFF,
    ConversationStage.CLOSED,
  ],
  [ConversationStage.COLLECTING_INFORMATION]: [
    ConversationStage.PRESENTING_SOLUTION,
    ConversationStage.HUMAN_HANDOFF,
    ConversationStage.CLOSED,
  ],
  [ConversationStage.PRESENTING_SOLUTION]: [
    ConversationStage.NEGOTIATING,
    ConversationStage.HUMAN_HANDOFF,
    ConversationStage.CLOSED,
  ],
  [ConversationStage.NEGOTIATING]: [
    ConversationStage.CONVERTED,
    ConversationStage.HUMAN_HANDOFF,
    ConversationStage.CLOSED,
  ],
  [ConversationStage.CONVERTED]: [],
  [ConversationStage.HUMAN_HANDOFF]: [
    ConversationStage.QUALIFYING,
    ConversationStage.NEGOTIATING,
    ConversationStage.CONVERTED,
    ConversationStage.CLOSED,
  ],
  [ConversationStage.CLOSED]: [],
};

export const STAGE_OBJECTIVES: Record<ConversationStage, string> = {
  [ConversationStage.NEW_CONVERSATION]:
    "Primeiro contato com o lead. Cumprimentar de forma acolhedora, apresentar-se e identificar o motivo inicial do contato.",
  [ConversationStage.QUALIFYING]:
    "Qualificação inicial. Entender as necessidades centrais do lead, perfil de interesse, avaliar urgência e verificar se está alinhado com nossos serviços.",
  [ConversationStage.COLLECTING_INFORMATION]:
    "Coleta de informações detalhadas. Obter dados específicos como nome, cidade/unidade, preferências, requisitos e prazos para estruturar a melhor proposta.",
  [ConversationStage.PRESENTING_SOLUTION]:
    "Apresentação da solução ideal. Explicar como nosso serviço atende perfeitamente à necessidade levantada, destacando benefícios e valor gerado.",
  [ConversationStage.NEGOTIATING]:
    "Negociação e alinhamento comercial. Tratar valores, condições de contratação, formas de pagamento, tirar dúvidas finais e preparar o fechamento.",
  [ConversationStage.CONVERTED]:
    "Conversão concluída com sucesso. Venda fechada, venda realizada, agendamento confirmado ou contratação finalizada.",
  [ConversationStage.HUMAN_HANDOFF]:
    "Transferência para atendimento humano com consultor especialista. Atendimento em andamento por consultor humano. O assistente de IA permanece em pausa aguardando intervenção humana.",
  [ConversationStage.CLOSED]:
    "Conversa encerrada. O lead foi desqualificado, perdeu o interesse ou o atendimento foi finalizado sem conversão no momento.",
};

export class StateMachineService {
  public static normalizeStage(stage: string | ConversationStage | null | undefined): ConversationStage {
    return normalizeConversationStage(stage);
  }

  public static getCanonicalStages(): ConversationStage[] {
    return [...CANONICAL_CONVERSATION_STAGES];
  }

  public static getObjectiveForStage(stage: ConversationStage | string): string {
    const norm = this.normalizeStage(stage);
    return STAGE_OBJECTIVES[norm] || "Conduzir a conversa de forma empática e profissional.";
  }

  public static validateTransition(
    currentStage: ConversationStage | string,
    targetStage: ConversationStage | string
  ): boolean {
    const normCurrent = this.normalizeStage(currentStage);
    const normTarget = this.normalizeStage(targetStage);

    if (normCurrent === normTarget) {
      return true;
    }
    const allowed = STAGE_TRANSITIONS[normCurrent] || [];
    return allowed.includes(normTarget);
  }

  public static getAllowedTransitions(stage: ConversationStage | string): ConversationStage[] {
    const norm = this.normalizeStage(stage);
    return [...(STAGE_TRANSITIONS[norm] || [])];
  }

  public static isTerminalState(stage: ConversationStage | string): boolean {
    const norm = this.normalizeStage(stage);
    return norm === ConversationStage.CONVERTED || norm === ConversationStage.CLOSED;
  }

  public static isTerminalStage(stage: ConversationStage | string): boolean {
    return this.isTerminalState(stage);
  }

  public static getNextRecommendedStage(currentStage: ConversationStage | string): ConversationStage {
    const norm = this.normalizeStage(currentStage);
    switch (norm) {
      case ConversationStage.NEW_CONVERSATION:
        return ConversationStage.QUALIFYING;
      case ConversationStage.QUALIFYING:
        return ConversationStage.COLLECTING_INFORMATION;
      case ConversationStage.COLLECTING_INFORMATION:
        return ConversationStage.PRESENTING_SOLUTION;
      case ConversationStage.PRESENTING_SOLUTION:
        return ConversationStage.NEGOTIATING;
      case ConversationStage.NEGOTIATING:
        return ConversationStage.CONVERTED;
      default:
        return norm;
    }
  }

  public static nextSuggestedStage(currentStage: ConversationStage | string): ConversationStage {
    return this.getNextRecommendedStage(currentStage);
  }
}
