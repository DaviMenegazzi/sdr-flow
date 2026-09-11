import { useState } from 'react';
import { Network, Search, Copy, Check, ArrowRight, CornerDownRight, AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { catalog, categoryColors } from '@sdr/flow';
import type { FlowNode } from '@sdr/shared';
import { useBuilder } from './store';

interface VariablesViewProps {
  onSelectNodeInCanvas: (nodeId: string) => void;
}

interface VariableInfo {
  name: string;
  tag: string;
  category: 'agent' | 'lead' | 'context' | 'flow' | 'system';
  description: string;
  producedBy?: { nodeId: string; nodeLabel: string; nodeType: string };
  consumedBy: Array<{ nodeId: string; nodeLabel: string; nodeType: string; field: string }>;
}

export function VariablesView({ onSelectNodeInCanvas }: VariablesViewProps) {
  const { graph } = useBuilder();
  const [search, setSearch] = useState('');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  // 1. Build map of producers
  const producers: Record<string, { nodeId: string; nodeLabel: string; nodeType: string }> = {};

  // Standard producers by node type
  for (const node of graph.nodes) {
    if (node.type === 'agent.decide') {
      producers['decision.reply'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['decision.handoff'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['decision.handoff_reason'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'agent.classify') {
      producers['decision.intent'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'agent.extract') {
      producers['decision.lead_data'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'agent.score') {
      producers['decision.score'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'agent.structured') {
      const keys = Array.isArray(node.config.outputKeys) ? node.config.outputKeys : ['message', 'done'];
      for (const k of keys) {
        producers[`structured.${k}`] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      }
    } else if (node.type === 'context.memory') {
      producers['commercialMemory'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['recentMessages'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['conversation.summary'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'context.knowledge') {
      producers['context.knowledge'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['knowledgeSnippets'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'input.media') {
      producers['mediaEnrichedText'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'input.normalize') {
      producers['normalizedPhone'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    } else if (node.type === 'flow.loop') {
      const counterVar = String(node.config.counterVar || 'loop_count');
      producers[counterVar] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
    }
  }

  // Known system variables
  const systemVariables: Record<string, { category: VariableInfo['category']; description: string }> = {
    'lead.name': { category: 'lead', description: 'Nome capturado do contato no WhatsApp' },
    'lead.phone': { category: 'lead', description: 'Número de telefone do lead' },
    'lead.city': { category: 'lead', description: 'Cidade informada pelo lead durante a qualificação' },
    'lead.interest': { category: 'lead', description: 'Serviço, plano ou cartão de interesse do lead' },
    'lead.urgency': { category: 'lead', description: 'Nível de urgência declarado' },
    'decision.reply': { category: 'agent', description: 'Mensagem de resposta formulada pelo agente de IA' },
    'decision.intent': { category: 'agent', description: 'Intenção classificada (ex: agendamento, preco, duvida)' },
    'decision.handoff': { category: 'agent', description: 'Booleano ("true"/"false") indicando se deve passar para humano' },
    'decision.handoff_reason': { category: 'agent', description: 'Motivo detalhado do encaminhamento humano' },
    'decision.score': { category: 'agent', description: 'Pontuação de qualificação comercial do lead (0 a 100)' },
    'decision.lead_data': { category: 'agent', description: 'Objeto JSON com entidades e dados cadastrais extraídos' },
    'commercialMemory': { category: 'context', description: 'Memória comercial acumulada das conversas anteriores' },
    'recentMessages': { category: 'context', description: 'Histórico formatado das últimas mensagens trocadas' },
    'context.knowledge': { category: 'context', description: 'Trechos de documentos recuperados via busca semântica RAG' },
    'conversation.summary': { category: 'context', description: 'Resumo executivo de conversas longas' },
    'mediaEnrichedText': { category: 'lead', description: 'Texto transcrito de mensagens de voz/áudio do WhatsApp' },
    'normalizedPhone': { category: 'lead', description: 'Telefone normalizado no padrão E.164 brasileiro' },
  };

  // 2. Scan all consumers (where variables are used with {{...}})
  const consumers: Record<string, Array<{ nodeId: string; nodeLabel: string; nodeType: string; field: string }>> = {};

  const regex = /\{\{([\w.]+)\}\}/g;

  for (const node of graph.nodes) {
    for (const [fieldKey, val] of Object.entries(node.config)) {
      if (typeof val === 'string') {
        let match;
        while ((match = regex.exec(val)) !== null) {
          const varName = match[1];
          if (varName) {
            if (!consumers[varName]) consumers[varName] = [];
            consumers[varName]!.push({
              nodeId: node.id,
              nodeLabel: node.label,
              nodeType: node.type,
              field: fieldKey,
            });
          }
        }
      }
    }
  }

  // 3. Union of all known, produced, and consumed variables
  const allVarNames = Array.from(new Set([
    ...Object.keys(producers),
    ...Object.keys(consumers),
    ...Object.keys(systemVariables),
  ]));

  const variablesList: VariableInfo[] = allVarNames.map(name => {
    const sys = systemVariables[name];
    let category: VariableInfo['category'] = sys ? sys.category : name.startsWith('structured.') ? 'agent' : 'system';
    return {
      name,
      tag: `{{${name}}}`,
      category,
      description: sys?.description || (name.startsWith('structured.') ? `Dado estruturado do campo ${name.replace('structured.', '')}` : 'Variável personalizada do fluxo'),
      producedBy: producers[name],
      consumedBy: consumers[name] || [],
    };
  });

  const filteredList = variablesList.filter(item => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return item.name.toLowerCase().includes(term) || item.description.toLowerCase().includes(term);
  });

  const handleCopyTag = (tag: string) => {
    navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1200px', margin: '0 auto', overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#0284c722', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Network size={20} color="#0284c7" />
            </div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Mapa de Variáveis & Dependências</h1>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            Rastreie onde cada dado é gerado e onde ele é consumido entre os blocos do seu fluxo. Copie as tags para usar em qualquer prompt ou mensagem.
          </p>
        </div>

        {/* Global Summary */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', fontSize: '12px' }}>
            <span style={{ color: 'var(--color-text-secondary)', display: 'block', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>Variáveis em Uso</span>
            <strong style={{ fontSize: '15px' }}>{Object.keys(consumers).length} ativas</strong>
          </div>
          <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', fontSize: '12px' }}>
            <span style={{ color: 'var(--color-text-secondary)', display: 'block', fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>Produtores Detectados</span>
            <strong style={{ fontSize: '15px', color: '#10b981' }}>{Object.keys(producers).length} geradores</strong>
          </div>
        </div>
      </div>

      {/* Search Input */}
      <div style={{ marginBottom: '20px', position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
        <input
          type="text"
          placeholder="Buscar variável por nome (ex: decision.reply, lead.name)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}
        />
      </div>

      {/* Variables Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
        {filteredList.map(item => {
          const isProduced = Boolean(item.producedBy);
          const isConsumed = item.consumedBy.length > 0;
          const isSystem = item.category === 'lead' || item.category === 'system';

          return (
            <div
              key={item.name}
              style={{
                background: 'var(--color-bg-primary)',
                borderRadius: '10px',
                border: '1px solid var(--color-border)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
              }}
            >
              <div>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      fontWeight: 700,
                      color: 'var(--color-bg-accent)',
                      background: 'var(--color-bg-secondary)',
                      padding: '3px 8px',
                      borderRadius: '5px',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {item.tag}
                  </span>

                  <button
                    onClick={() => handleCopyTag(item.tag)}
                    style={{
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      borderRadius: '5px',
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                    }}
                    title="Copiar tag para usar em mensagens ou prompts"
                  >
                    {copiedTag === item.tag ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                    {copiedTag === item.tag ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>

                <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  {item.description}
                </p>

                {/* Lineage Details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
                  {/* Origin */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', width: '80px', flexShrink: 0 }}>Gerado em:</span>
                    {item.producedBy ? (
                      <button
                        onClick={() => onSelectNodeInCanvas(item.producedBy!.nodeId)}
                        style={{
                          border: '1px solid #10b98144',
                          background: '#10b98115',
                          color: '#059669',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontWeight: 600,
                          fontSize: '11px',
                        }}
                      >
                        <CheckCircle2 size={11} />
                        {item.producedBy.nodeLabel}
                      </button>
                    ) : isSystem ? (
                      <span style={{ color: '#0284c7', background: '#0284c715', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                        Injetado pelo Sistema / WhatsApp
                      </span>
                    ) : (
                      <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertTriangle size={12} />
                        Nenhum bloco gerador no fluxo
                      </span>
                    )}
                  </div>

                  {/* Consumed By */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                    <span style={{ color: 'var(--color-text-secondary)', width: '80px', flexShrink: 0, marginTop: '2px' }}>
                      Consumido em:
                    </span>
                    {item.consumedBy.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {item.consumedBy.map((consumer, idx) => (
                          <button
                            key={idx}
                            onClick={() => onSelectNodeInCanvas(consumer.nodeId)}
                            style={{
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-bg-secondary)',
                              color: 'var(--color-text-primary)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '11px',
                            }}
                          >
                            <ArrowRight size={10} color="var(--color-bg-accent)" />
                            {consumer.nodeLabel} ({consumer.field})
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                        Não utilizado em nenhum bloco
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status footer */}
              <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--color-border-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px' }}>
                <span style={{ color: 'var(--color-text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  {item.category === 'agent' ? '🤖 Inteligência' : item.category === 'lead' ? '👤 Cadastro Lead' : item.category === 'context' ? '🧠 Memória/RAG' : '⚙️ Controle'}
                </span>
                {isProduced && isConsumed && (
                  <span style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <CheckCircle2 size={11} /> Conectada
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
