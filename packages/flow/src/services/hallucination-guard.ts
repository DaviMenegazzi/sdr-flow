export interface HallucinationCheckInput {
  userMessage: string;
  proposedReply: string;
  knowledgeSnippets?: string[];
  strict?: boolean;
}

export interface HallucinationCheckResult {
  allowed: boolean;
  reason?: string;
  sanitizedReply: string;
  triggerHandoff: boolean;
  handoffReason?: string;
}

export class HallucinationGuard {
  private static readonly PRICING_REGEX =
    /\b(preço|precos|quanto custa|valor|valores|tabela|mensalidade|custo|custos|taxa|taxas|r\$|\bmoeda\b|desconto|orçamento|orcamento)\b/i;

  private static readonly AVAILABILITY_REGEX =
    /\b(disponibilidade|disponível|disponivel|tem vaga|tem vaga hoje|horário|horario|agenda|agendar|vagas)\b/i;

  /**
   * Evaluates whether the proposed reply hallucinates pricing or availability
   * without grounding in the knowledge base.
   */
  public static verify(input: HallucinationCheckInput): HallucinationCheckResult {
    const { userMessage, proposedReply, knowledgeSnippets = [], strict = true } = input;

    const asksPricing = HallucinationGuard.PRICING_REGEX.test(userMessage);
    const asksAvailability = HallucinationGuard.AVAILABILITY_REGEX.test(userMessage);

    // If the user didn't ask for pricing or availability, pass through
    if (!asksPricing && !asksAvailability) {
      return {
        allowed: true,
        sanitizedReply: proposedReply,
        triggerHandoff: false,
      };
    }

    const snippetsText = knowledgeSnippets.join(' ').toLowerCase();
    const hasPricingKnowledge =
      HallucinationGuard.PRICING_REGEX.test(snippetsText) || /r\$|\d+,\d{2}|\d+\s*reais/i.test(snippetsText);
    const hasAvailabilityKnowledge = HallucinationGuard.AVAILABILITY_REGEX.test(snippetsText);

    // 1. Check Pricing hallucination
    if (asksPricing && !hasPricingKnowledge) {
      // The user asked about price, but knowledge base has no price info
      return {
        allowed: false,
        reason: 'Preço solicitado ausente na base de conhecimento da organização',
        sanitizedReply:
          'Não encontrei a tabela de preços oficial confirmada na minha base de informações. Para garantir que você receba o valor exato e atualizado, estou transferindo você para nossa equipe de atendimento humano!',
        triggerHandoff: true,
        handoffReason: 'Preço não encontrado na base de conhecimento',
      };
    }

    // 2. Check Availability hallucination
    if (asksAvailability && !hasAvailabilityKnowledge && strict) {
      return {
        allowed: false,
        reason: 'Disponibilidade solicitada ausente na base de conhecimento da organização',
        sanitizedReply:
          'Não localizei a disponibilidade de agenda em tempo real na minha base. Vou encaminhar sua solicitação para um consultor confirmar os horários disponíveis para você!',
        triggerHandoff: true,
        handoffReason: 'Disponibilidade não encontrada na base de conhecimento',
      };
    }

    return {
      allowed: true,
      sanitizedReply: proposedReply,
      triggerHandoff: false,
    };
  }
}
