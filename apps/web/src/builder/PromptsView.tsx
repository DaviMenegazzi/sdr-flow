import { useState } from 'react';
import {
  Bot,
  Sparkles,
  BookOpen,
  Search,
  ExternalLink,
  Check,
  Copy,
  AlertCircle,
  Cpu,
  Sliders,
  CreditCard,
  Stethoscope,
  HelpCircle,
  ShieldAlert,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Input, SegmentedControl } from '../components/ui';
import { catalog, categoryColors } from '@sdr/flow';
import type { FlowNode } from '@sdr/shared';
import { useBuilder } from './store';

interface PromptsViewProps {
  onSelectNodeInCanvas: (nodeId: string) => void;
}

const KNOWLEDGE_COLLECTIONS: Record<string, { label: string; icon: LucideIcon }> = {
  default: { label: 'Todas as coleções', icon: BookOpen },
  pricing: { label: 'Preços & Planos', icon: CreditCard },
  catalog: { label: 'Catálogo & Serviços', icon: Stethoscope },
  faq: { label: 'Dúvidas & FAQ', icon: HelpCircle },
  objections: { label: 'Objeções Comerciais', icon: ShieldAlert },
  documents: { label: 'Políticas & Diretrizes', icon: FileText },
};

export function PromptsView({ onSelectNodeInCanvas }: PromptsViewProps) {
  const { graph, update } = useBuilder();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter nodes that have prompts or knowledge
  const promptNodes = graph.nodes.filter(node => {
    const hasPrompt = typeof node.config.prompt === 'string';
    const hasSystem = typeof node.config.system === 'string';
    const isKnowledge = node.type === 'context.knowledge';
    const isOutputText = node.type === 'output.send_text';
    return hasPrompt || hasSystem || isKnowledge || isOutputText;
  });

  const knowledgeNodes = graph.nodes.filter(n => n.type === 'context.knowledge');
  const activeCollections = knowledgeNodes.map(n => String(n.config.collection || 'default'));

  const filteredNodes = promptNodes.filter(node => {
    if (filterType !== 'ALL' && node.type !== filterType) return false;
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    const label = (node.label || '').toLowerCase();
    const prompt = String(node.config.prompt || '').toLowerCase();
    const system = String(node.config.system || '').toLowerCase();
    const text = String(node.config.text || '').toLowerCase();
    return label.includes(term) || prompt.includes(term) || system.includes(term) || text.includes(term);
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-6 py-6">
      {/* Context in one line; the tab itself already says where you are. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Filtrar blocos"
          value={filterType}
          onChange={setFilterType}
          options={[
            { value: 'ALL', label: 'Todos', count: promptNodes.length },
            ...Array.from(new Set(promptNodes.map(n => n.type))).map(type => ({ value: type, label: catalog[type]?.label || type })),
          ]}
        />
        <div className="ml-auto w-full max-w-xs">
          <Input aria-label="Buscar nos prompts" placeholder="Buscar nos prompts" value={search} onChange={e => setSearch(e.target.value)} leftIcon={<Search size={14} />} className="!h-8" />
        </div>
      </div>
      <p className="m-0 mb-4 flex flex-wrap items-center gap-1.5 text-xs text-content-secondary">
        {promptNodes.length} {promptNodes.length === 1 ? 'bloco usa' : 'blocos usam'} IA ·{' '}
        {knowledgeNodes.length > 0 ? (
          <span>{knowledgeNodes.length} base(s) de conhecimento ligada(s)</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-warning">
            nenhuma base de conhecimento ligada
            <Link to="/knowledge" className="font-semibold underline-offset-2 hover:underline">Ver base</Link>
          </span>
        )}
        · As edições vão para o rascunho; publique para valer no WhatsApp.
      </p>

      {/* Nodes List */}
      {filteredNodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--color-bg-secondary)', borderRadius: '12px', border: '1px dashed var(--color-border)' }}>
          <Bot size={40} strokeWidth={1.2} style={{ color: 'var(--color-text-secondary)', marginBottom: '12px' }} />
          <h3 style={{ margin: '0 0 6px 0', fontSize: '16px' }}>Nenhum prompt encontrado</h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            Nenhum nó de inteligência corresponde aos filtros atuais. Adicione nós como <strong>Decisão do agente</strong> ou <strong>Base de conhecimento</strong> no Canvas.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {filteredNodes.map(node => {
            const def = catalog[node.type];
            const isKnowledge = node.type === 'context.knowledge';
            const isOutputText = node.type === 'output.send_text';
            const promptText = String(node.config.prompt || '');
            const systemText = String(node.config.system || '');
            const msgText = String(node.config.text || '');

            return (
              <div
                key={node.id}
                style={{
                  background: 'var(--color-bg-primary)',
                  borderRadius: '12px',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Node Card Header */}
                <div
                  style={{
                    padding: '14px 20px',
                    background: 'var(--color-bg-secondary)',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: categoryColors[def?.category || 'agent'],
                        display: 'inline-block',
                      }}
                    />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{node.label}</h3>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                          {def?.label || node.type}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {!isKnowledge && !isOutputText && (
                      <span style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', background: '#3b82f615', color: '#2563eb', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Cpu size={12} />
                        {String(node.config.provider || 'openai').toUpperCase()} · modelo do agente da instância
                      </span>
                    )}

                    <button
                      onClick={() => onSelectNodeInCanvas(node.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        fontSize: '11px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-primary)',
                        cursor: 'pointer',
                        color: 'var(--color-text-primary)',
                      }}
                      title="Abrir e destacar este nó no construtor visual"
                    >
                      <ExternalLink size={12} />
                      Ver no Canvas
                    </button>
                  </div>
                </div>

                {/* Node Card Body */}
                <div style={{ padding: '20px' }}>
                  {isKnowledge && (
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                        Coleção da Base de Conhecimento vinculada
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                        {Object.entries(KNOWLEDGE_COLLECTIONS).map(([key, item]) => {
                          const isSelected = (node.config.collection || 'default') === key;
                          return (
                            <div
                              key={key}
                              onClick={() => update(node.id, { config: { ...node.config, collection: key } })}
                              style={{
                                padding: '10px 12px',
                                borderRadius: '8px',
                                border: isSelected ? '2px solid var(--color-bg-accent)' : '1px solid var(--color-border)',
                                background: isSelected ? 'rgba(46, 232, 107, 0.12)' : 'var(--color-bg-secondary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.15s',
                              }}
                            >
                              <item.icon size={16} style={{ color: isSelected ? 'var(--color-bg-accent)' : 'inherit' }} />
                              <span style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 400, color: isSelected ? 'var(--color-bg-accent)' : 'var(--color-text-primary)' }}>
                                {item.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: '8px', fontSize: '12px' }}>
                        <div>
                          <span style={{ color: 'var(--color-text-secondary)', display: 'block', fontSize: '11px', textTransform: 'uppercase' }}>Trechos Máximos (Top K)</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={Number(node.config.topK || 5)}
                            onChange={e => update(node.id, { config: { ...node.config, topK: Number(e.target.value) || 5 } })}
                            style={{ width: '70px', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--color-border)', marginTop: '4px' }}
                          />
                        </div>
                        <div>
                          <span style={{ color: 'var(--color-text-secondary)', display: 'block', fontSize: '11px', textTransform: 'uppercase' }}>Similaridade Mínima (Threshold)</span>
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            max={1}
                            value={Number(node.config.threshold ?? 0.7)}
                            onChange={e => update(node.id, { config: { ...node.config, threshold: Number(e.target.value) } })}
                            style={{ width: '80px', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--color-border)', marginTop: '4px' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {isOutputText && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                          Mensagem de Envio para o WhatsApp
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                          <span>{msgText.length} caracteres</span>
                          <span>~{estimateTokens(msgText)} tokens</span>
                          <button
                            onClick={() => handleCopy(msgText, `${node.id}-msg`)}
                            style={{ border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-secondary)' }}
                          >
                            {copiedId === `${node.id}-msg` ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                            {copiedId === `${node.id}-msg` ? 'Copiado' : 'Copiar'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        value={msgText}
                        onChange={e => update(node.id, { config: { ...node.config, text: e.target.value } })}
                        placeholder="Ex: {{decision.reply}}"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg-secondary)',
                          fontSize: '13px',
                          fontFamily: 'monospace',
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  )}

                  {!isKnowledge && !isOutputText && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {activeCollections.length > 0 && (
                        <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#10b98112', border: '1px solid #10b98133', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#047857' }}>
                          <BookOpen size={14} />
                          <span>
                            Este agente tem acesso automático às coleções de conhecimento ativas no fluxo: <strong>{activeCollections.join(', ')}</strong>.
                          </span>
                        </div>
                      )}

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                            Prompt de Instrução Principal
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                            <span>{promptText.split(/\s+/).filter(Boolean).length} palavras</span>
                            <span>~{estimateTokens(promptText)} tokens</span>
                            <button
                              onClick={() => handleCopy(promptText, `${node.id}-p`)}
                              style={{ border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-secondary)' }}
                            >
                              {copiedId === `${node.id}-p` ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                              {copiedId === `${node.id}-p` ? 'Copiado' : 'Copiar'}
                            </button>
                          </div>
                        </div>
                        <textarea
                          rows={6}
                          value={promptText}
                          onChange={e => update(node.id, { config: { ...node.config, prompt: e.target.value } })}
                          placeholder="Digite aqui as instruções que guiam o raciocínio da IA..."
                          style={{
                            width: '100%',
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg-secondary)',
                            fontSize: '13px',
                            lineHeight: 1.5,
                            resize: 'vertical',
                          }}
                        />
                      </div>

                      {(systemText || typeof node.config.system !== 'undefined') && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                              Instrução de Sistema (Persona & Diretrizes Estruturais)
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                              <span>{systemText.split(/\s+/).filter(Boolean).length} palavras</span>
                              <span>~{estimateTokens(systemText)} tokens</span>
                              <button
                                onClick={() => handleCopy(systemText, `${node.id}-s`)}
                                style={{ border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-secondary)' }}
                              >
                                {copiedId === `${node.id}-s` ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                                {copiedId === `${node.id}-s` ? 'Copiado' : 'Copiar'}
                              </button>
                            </div>
                          </div>
                          <textarea
                            rows={8}
                            value={systemText}
                            onChange={e => update(node.id, { config: { ...node.config, system: e.target.value } })}
                            placeholder="Instruções de sistema, tom de voz, regras regulatórias, compliance..."
                            style={{
                              width: '100%',
                              padding: '12px',
                              borderRadius: '8px',
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-bg-secondary)',
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              lineHeight: 1.5,
                              resize: 'vertical',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
