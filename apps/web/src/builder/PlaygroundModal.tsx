import { useState, useEffect } from 'react';
import { Play, X, Bot, User, CheckCircle2, AlertTriangle, Cpu, Database, BookOpen, Layers } from 'lucide-react';
import type { FlowGraph } from '@sdr/shared';
import { runPlayground, type PlaygroundResult } from '@sdr/flow';
import { useSession } from '../session';

interface PlaygroundModalProps {
  isOpen: boolean;
  onClose: () => void;
  flowId?: string | null;
  graph: FlowGraph;
}

export function PlaygroundModal({ isOpen, onClose, flowId, graph }: PlaygroundModalProps) {
  const { session, activeOrg } = useSession();

  const [leadName, setLeadName] = useState('Carlos Oliveira');
  const [leadPhone, setLeadPhone] = useState('+5511988887777');
  const [leadInterest, setLeadInterest] = useState('Plano Odontológico Familiar');
  const [leadCity, setLeadCity] = useState('Campinas');
  const [message, setMessage] = useState('Olá! Gostaria de saber os preços e a cobertura do plano.');

  const [loading, setLoading] = useState(false);
  const [llmMode, setLlmMode] = useState<'mock' | 'openai'>('mock');
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [activeTab, setActiveTab] = useState<'response' | 'prompt' | 'trace' | 'memory' | 'knowledge'>('response');
  const [customApiKey, setCustomApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen && graph.testMode?.enabled) setLeadPhone(graph.testMode.phone);
  }, [isOpen, graph.testMode?.enabled, graph.testMode?.phone]);

  if (!isOpen) return null;

  async function handleRun() {
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/flows/playground', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          graph,
          flowId: flowId || undefined,
          llm: llmMode,
          openaiApiKey: customApiKey.trim() || undefined,
          message,
          lead: {
            name: leadName,
            phone: leadPhone,
            interest: leadInterest,
            city: leadCity,
          },
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Erro ao rodar playground (${response.status})`);
      }

      const data = (await response.json()) as PlaygroundResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar fluxo');
    } finally {
      setLoading(false);
    }
  }

  const sentReply = result?.sentMessages?.[0]?.content || (result?.decision?.reply as string) || '';

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          width: '94vw',
          maxWidth: 1100,
          height: '88vh',
          maxHeight: 820,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-bg-primary)',
          borderRadius: 12,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: '1px solid var(--color-border-secondary)',
          padding: 0,
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--color-border-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--color-bg-secondary)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Play size={18} style={{ color: 'var(--color-brand)' }} />
            <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Playground de Fluxo</h2>
            <span className="badge" style={{ textTransform: 'uppercase', fontSize: 11 }}>
              Sem envio ao WhatsApp
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Left Column: Test inputs */}
          <div
            style={{
              width: 350,
              minWidth: 300,
              maxWidth: 380,
              flexShrink: 0,
              padding: 20,
              borderRight: '1px solid var(--color-border-secondary)',
              overflowY: 'auto',
              minHeight: 0,
              background: 'var(--color-bg-surface)',
            }}
          >
            <label htmlFor="playground-llm">Inteligência artificial</label>
            <select id="playground-llm" value={llmMode} onChange={e => { setLlmMode(e.target.value as 'mock' | 'openai'); setResult(null); }} disabled={loading} style={{ width: '100%', marginBottom: 8 }}>
              <option value="mock">Resposta simulada</option>
              <option value="openai">OpenAI — IA real, WhatsApp simulado</option>
            </select>
            <p style={{ fontSize: 12, marginBottom: 16 }}>OpenAI usa a chave configurada no servidor e consome tokens da sua conta. Nenhuma mensagem é enviada ao WhatsApp.</p>
            {llmMode === 'openai' && (
              <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--color-bg-secondary)', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                  Chave OpenAI personalizada (opcional):
                </label>
                <input
                  type="password"
                  value={customApiKey}
                  onChange={e => setCustomApiKey(e.target.value)}
                  placeholder="sk-proj-... (deixe vazio para usar a da VPS)"
                  style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4, display: 'block' }}>
                  Por padrão, o servidor já utiliza a chave OpenAI da VPS.
                </span>
              </div>
            )}
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              1. Contexto do Lead
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Nome</label>
                <input
                  type="text"
                  value={leadName}
                  onChange={e => setLeadName(e.target.value)}
                  placeholder="Ex: Carlos Oliveira"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Telefone</label>
                  <input
                    type="text"
                    value={leadPhone}
                    onChange={e => setLeadPhone(e.target.value)}
                    placeholder="+5511..."
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Cidade</label>
                  <input
                    type="text"
                    value={leadCity}
                    onChange={e => setLeadCity(e.target.value)}
                    placeholder="Ex: Campinas"
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Interesse declarado</label>
                <input
                  type="text"
                  value={leadInterest}
                  onChange={e => setLeadInterest(e.target.value)}
                  placeholder="Ex: Plano Odontológico"
                />
              </div>
            </div>

            <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              2. Mensagem do Lead
            </h3>
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Digite a mensagem simulando o envio pelo WhatsApp..."
              style={{ width: '100%', marginBottom: 10, resize: 'vertical' }}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => setMessage('Quanto custa a mensalidade do plano familiar?')}
              >
                Preço / Valores
              </button>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => setMessage('Quais os horários de atendimento e disponibilidade?')}
              >
                Disponibilidade
              </button>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => setMessage('Quais serviços estão inclusos na cobertura?')}
              >
                Cobertura
              </button>
            </div>

            <button
              type="button"
              className="primary"
              disabled={loading || !message.trim()}
              onClick={handleRun}
              style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
            >
              <Play size={16} />
              {loading ? 'Executando motor...' : 'Executar no Playground'}
            </button>

            {error && (
              <div style={{ marginTop: 12, padding: 8, background: '#fee2e2', color: '#b91c1c', borderRadius: 6, fontSize: 12 }}>
                {error}
              </div>
            )}
            {result?.testModeBlocked && <p role="status" style={{ marginTop: 12 }}>Modo Teste: número não autorizado. A IA não foi chamada e nenhuma mensagem foi enviada.</p>}
          </div>

          {/* Right Column: Results & Tabs */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: 'var(--color-bg-base)',
            }}
          >
            {result && (
              <div
                style={{
                  padding: '10px 16px',
                  background: 'var(--color-bg-secondary)',
                  borderBottom: '1px solid var(--color-border-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-success)' }}>
                    <CheckCircle2 size={14} /> Status: {result.status}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Passos: <strong>{result.steps.length}</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <Cpu size={14} style={{ color: 'var(--color-brand)' }} />
                    <span>
                      Tokens: <strong>{result.tokens.total}</strong> ({result.tokens.input} in / {result.tokens.output} out)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs Header */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--color-border-secondary)',
                padding: '0 8px',
                background: 'var(--color-bg-surface)',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                className={`tab-btn ${activeTab === 'response' ? 'active' : ''}`}
                onClick={() => setActiveTab('response')}
              >
                <Bot size={14} />
                Resposta
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'prompt' ? 'active' : ''}`}
                onClick={() => setActiveTab('prompt')}
              >
                <Layers size={14} />
                Prompt Final
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'trace' ? 'active' : ''}`}
                onClick={() => setActiveTab('trace')}
              >
                <Layers size={14} />
                Trace de Nós ({result?.steps.length || 0})
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'memory' ? 'active' : ''}`}
                onClick={() => setActiveTab('memory')}
              >
                <Database size={14} />
                Memória Comercial
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'knowledge' ? 'active' : ''}`}
                onClick={() => setActiveTab('knowledge')}
              >
                <BookOpen size={14} />
                Base Consultada
              </button>
            </div>

            {/* Tab Contents */}
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: 20, overflowY: 'auto', overflowX: 'hidden' }}>
              {!result ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '40px 0' }}>
                  <Play size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                  <p>Configure o lead e clique em “Executar no Playground” para ver o comportamento do fluxo.</p>
                </div>
              ) : (
                <>
                  {activeTab === 'response' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {/* Chat Bubbles */}
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ padding: 6, background: '#e0f2fe', borderRadius: '50%', flexShrink: 0 }}>
                          <User size={16} color="#0284c7" />
                        </div>
                        <div
                          style={{
                            background: 'var(--color-bg-surface)',
                            padding: '10px 14px',
                            borderRadius: 8,
                            maxWidth: '85%',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            border: '1px solid var(--color-border-secondary)',
                            fontSize: 13,
                          }}
                        >
                          <strong>Lead:</strong>
                          <p style={{ margin: '4px 0 0' }}>{message}</p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ padding: 6, background: '#dcfce7', borderRadius: '50%', flexShrink: 0 }}>
                          <Bot size={16} color="#16a34a" />
                        </div>
                        <div
                          style={{
                            background: 'var(--color-bg-surface)',
                            padding: '10px 14px',
                            borderRadius: 8,
                            maxWidth: '85%',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            border: '1px solid var(--color-border-secondary)',
                            fontSize: 13,
                          }}
                        >
                          <strong>Agente SDR:</strong>
                          <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{sentReply || '(Nenhuma mensagem enviada)'}</p>
                        </div>
                      </div>

                      {/* Decision Summary Card */}
                      {result.decision && (
                        <div
                          style={{
                            marginTop: 12,
                            padding: 14,
                            background: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-border-secondary)',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        >
                          <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Decisão do Agente</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                            <div>
                              <span style={{ color: 'var(--color-text-secondary)' }}>Intenção:</span>{' '}
                              <strong>{result.decision.intent || '—'}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--color-text-secondary)' }}>Estágio:</span>{' '}
                              <strong>{result.decision.stage || '—'}</strong>
                            </div>
                            <div>
                              <span style={{ color: 'var(--color-text-secondary)' }}>Handoff humano:</span>{' '}
                              <strong>{result.decision.handoff ? 'SIM' : 'NÃO'}</strong>
                            </div>
                            {result.decision.handoff_reason && (
                              <div style={{ gridColumn: '1 / -1', color: '#b91c1c' }}>
                                <AlertTriangle size={13} style={{ display: 'inline', marginRight: 4 }} />
                                Motivo do handoff: {result.decision.handoff_reason}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'prompt' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          Prompt exato enviado ao modelo com variáveis, histórico e conhecimento interpolados:
                        </span>
                      </div>
                      <pre
                        style={{
                          background: 'var(--color-bg-secondary)',
                          padding: 14,
                          borderRadius: 8,
                          fontSize: 12,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          maxHeight: 450,
                          overflowY: 'auto',
                          overflowX: 'auto',
                          fontFamily: 'monospace',
                        }}
                      >
                        {result.finalPrompt || 'Nenhum prompt foi gravado para esta execução.'}
                      </pre>
                    </div>
                  )}

                  {activeTab === 'trace' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {result.steps.map((step, idx) => (
                        <div
                          key={step.sequence || idx}
                          style={{
                            padding: '10px 12px',
                            background: 'var(--color-bg-surface)',
                            border: '1px solid var(--color-border-secondary)',
                            borderRadius: 6,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 12,
                          }}
                        >
                          <div>
                            <span style={{ color: 'var(--color-text-secondary)', marginRight: 8 }}>#{step.sequence}</span>
                            <strong>{step.nodeType}</strong>
                            <span style={{ marginLeft: 8, opacity: 0.7 }}>({step.nodeId})</span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <span className="badge" style={{ fontSize: 11 }}>
                              Porta: {(step.output as any)?.port ?? 'next'}
                            </span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>{step.durationMs}ms</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'memory' && (
                    <div>
                      <pre
                        style={{
                          background: 'var(--color-bg-secondary)',
                          padding: 14,
                          borderRadius: 8,
                          fontSize: 12,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere',
                          maxHeight: 450,
                          overflowY: 'auto',
                          overflowX: 'auto',
                          fontFamily: 'monospace',
                        }}
                      >
                        {JSON.stringify(result.commercialMemory, null, 2)}
                      </pre>
                    </div>
                  )}

                  {activeTab === 'knowledge' && (
                    <div>
                      {result.knowledgeUsed && result.knowledgeUsed.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {result.knowledgeUsed.map((snippet, idx) => (
                            <div
                              key={idx}
                              style={{
                                padding: 12,
                                background: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border-secondary)',
                                borderRadius: 6,
                                fontSize: 12,
                              }}
                            >
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>Trecho #{idx + 1}</div>
                              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{snippet}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
                          Nenhum trecho da base de conhecimento foi acionado neste fluxo.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
