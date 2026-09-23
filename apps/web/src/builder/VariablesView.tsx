import { useState } from 'react';
import { Search, Copy, Check, AlertTriangle } from 'lucide-react';
import { Input, SegmentedControl, toast } from '../components/ui';
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
    } else if (node.type === 'flow.do_while') {
      const counterVar = String(node.config.counterVar || 'do_while_count');
      producers[counterVar] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['do_while.condition_result'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
      producers['do_while.exit_reason'] = { nodeId: node.id, nodeLabel: node.label, nodeType: node.type };
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

  // Lead fields are filled by the runtime itself; anything else used without a producer arrives empty.
  const isBroken = (item: VariableInfo) => item.consumedBy.length > 0 && !item.producedBy && !item.name.startsWith('lead.');
  const broken = variablesList.filter(isBroken);
  const used = variablesList.filter(item => item.consumedBy.length > 0);
  const [view, setView] = useState<'used' | 'broken' | 'all'>(() => (broken.length ? 'broken' : 'used'));

  const filteredList = variablesList
    .filter(item => (view === 'used' ? item.consumedBy.length > 0 : view === 'broken' ? isBroken(item) : true))
    .filter(item => {
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      return item.name.toLowerCase().includes(term) || item.description.toLowerCase().includes(term);
    })
    .sort((a, b) => Number(isBroken(b)) - Number(isBroken(a)) || b.consumedBy.length - a.consumedBy.length || a.name.localeCompare(b.name));

  const handleCopyTag = (tag: string) => {
    void navigator.clipboard?.writeText(tag);
    setCopiedTag(tag);
    toast.success('Variável copiada', { description: tag });
    setTimeout(() => setCopiedTag(null), 2000);
  };

  const nodeChip = (ref: { nodeId: string; nodeLabel: string; nodeType: string }, key?: string) => (
    <button
      key={key ?? ref.nodeId}
      type="button"
      onClick={() => onSelectNodeInCanvas(ref.nodeId)}
      className="inline-flex min-h-0 items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-2xs text-content hover:border-border-strong"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: categoryColors[catalog[ref.nodeType as keyof typeof catalog]?.category ?? 'flow'] }} />
      {ref.nodeLabel}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Mostrar variáveis"
            value={view}
            onChange={setView}
            options={[
              { value: 'used', label: 'Em uso', count: used.length },
              { value: 'broken', label: 'Com problema', count: broken.length },
              { value: 'all', label: 'Todas', count: variablesList.length },
            ]}
          />
          <div className="ml-auto w-full max-w-xs">
            <Input aria-label="Buscar variável" placeholder="Buscar variável" value={search} onChange={e => setSearch(e.target.value)} leftIcon={<Search size={14} />} className="!h-8" />
          </div>
        </div>

        {broken.length > 0 && view !== 'broken' && (
          <button
            type="button"
            onClick={() => setView('broken')}
            className="flex min-h-0 items-center justify-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-left text-xs text-warning"
          >
            <AlertTriangle size={14} /> {broken.length} variável(is) usada(s) sem nenhum bloco que as gere — vão chegar vazias.
          </button>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border text-2xs text-content-muted">
                <th className="px-4 py-2.5 font-medium">Variável</th>
                <th className="px-4 py-2.5 font-medium">Gerada em</th>
                <th className="px-4 py-2.5 font-medium">Usada em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredList.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-content-muted">
                    {view === 'broken' ? 'Nenhuma variável com problema. Tudo o que é usado tem origem.' : 'Nenhuma variável encontrada.'}
                  </td>
                </tr>
              )}
              {filteredList.map(item => (
                <tr key={item.name} className="group align-top hover:bg-surface-elevated/50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleCopyTag(item.tag)}
                      className="inline-flex min-h-0 items-center gap-1.5 rounded border-0 bg-transparent p-0 font-mono text-xs text-content hover:text-brand-fg"
                      title="Copiar"
                    >
                      {item.tag}
                      {copiedTag === item.tag ? <Check size={12} className="text-success" /> : <Copy size={12} className="opacity-0 group-hover:opacity-60" />}
                    </button>
                    <p className="m-0 mt-1 max-w-sm text-2xs text-content-muted">{item.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    {item.producedBy ? (
                      nodeChip(item.producedBy)
                    ) : item.name.startsWith('lead.') ? (
                      <span className="text-2xs text-content-muted">Automática (contato)</span>
                    ) : (
                      <span className={`text-2xs ${isBroken(item) ? 'font-medium text-warning' : 'text-content-muted'}`}>
                        {isBroken(item) ? 'Nenhum bloco gera' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.consumedBy.length ? (
                      <div className="flex flex-wrap gap-1">{item.consumedBy.map((ref, index) => nodeChip(ref, `${ref.nodeId}-${ref.field}-${index}`))}</div>
                    ) : (
                      <span className="text-2xs text-content-muted">Não usada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
