import { useState, useEffect } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  FileText,
  CheckCircle2,
  Database,
  X,
  Sparkles,
  Edit3,
  ExternalLink,
  AlertCircle,
  HelpCircle,
  Check,
  Layers,
} from 'lucide-react';
import { useSession } from '../session';

interface KnowledgeDoc {
  id: string;
  collection: string;
  title: string;
  content: string;
  token_count: number;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface SearchHit {
  id: string;
  collection: string;
  title: string;
  content: string;
  similarity: number;
}

interface CollectionMeta {
  id: string;
  name: string;
  icon: string;
  tagColor: string;
  badgeBg: string;
  description: string;
  placeholderTitle: string;
  exampleContent: string;
}

const COLLECTIONS: CollectionMeta[] = [
  {
    id: 'pricing',
    name: 'Preços & Planos',
    icon: '💳',
    tagColor: '#10b981',
    badgeBg: 'rgba(16, 185, 129, 0.12)',
    description: 'Tabelas de mensalidades, taxas de adesão, coparticipação e condições de pagamento.',
    placeholderTitle: 'Ex: Tabela de Preços Vida Card Individual e Familiar 2026',
    exampleContent: `Plano Familiar Vida Card:
• Mensalidade: R$ 89,90 por mês (inclui titular + até 4 dependentes diretos).
• Taxa de adesão: R$ 30,00 (isenção temporária na adesão online).
• Consultas médicas com clínico geral: R$ 45,00 cada.
• Consultas com especialistas (pediatra, cardiologista, etc.): R$ 60,00 a R$ 80,00.
• Descontos em farmácias credenciadas: de 20% a 60% em medicamentos genéricos.
• Formas de pagamento aceitas: Cartão de crédito, Boleto bancário ou PIX recorrente.`,
  },
  {
    id: 'catalog',
    name: 'Catálogo & Serviços',
    icon: '🩺',
    tagColor: '#3b82f6',
    badgeBg: 'rgba(59, 130, 246, 0.12)',
    description: 'Especialidades médicas disponíveis, exames laboratoriais e procedimentos cobertos.',
    placeholderTitle: 'Ex: Especialidades Médicas e Exames Atendidos na Região',
    exampleContent: `Especialidades e Cobertura de Atendimento:
• Médicos especialistas: Clínica Geral, Pediatria, Ginecologia/Obstetrícia, Ortopedia, Oftalmologia, Cardiologia e Dermatologia.
• Odontologia: Avaliação, profilaxia (limpeza), restaurações e tratamento de canal com valores reduzidos.
• Exames laboratoriais: Hemograma completo, glicemia, colesterol, exames hormonais e urina.
• Exames de imagem: Ultrassonografia simples e com doppler, Raio-X digital e Eletrocardiograma.`,
  },
  {
    id: 'faq',
    name: 'Dúvidas & FAQ',
    icon: '❓',
    tagColor: '#8b5cf6',
    badgeBg: 'rgba(139, 92, 246, 0.12)',
    description: 'Carências, agendamento de consultas, dependentes permitidos e horários.',
    placeholderTitle: 'Ex: Regras de Carência para Consultas e Procedimentos',
    exampleContent: `Prazos de Carência e Regras de Agendamento:
• Consultas médicas gerais: Sem carência! Podem ser agendadas logo após a confirmação da contratação.
• Exames laboratoriais básicos: Sem carência.
• Procedimentos odontológicos e exames de média complexidade: Carência de 30 dias.
• Como agendar: Diretamente pelo WhatsApp com a nossa equipe ou no aplicativo Vida Card.
• Dependentes aceitos: Cônjuge, filhos até 24 anos e pais/sogros como adicionais.`,
  },
  {
    id: 'objections',
    name: 'Objeções de Vendas',
    icon: '🛡️',
    tagColor: '#f59e0b',
    badgeBg: 'rgba(245, 158, 11, 0.12)',
    description: 'Respostas persuasivas para "está caro", "já tenho convênio", "vou pensar".',
    placeholderTitle: 'Ex: Como contornar quando o lead achar o plano caro',
    exampleContent: `Argumentação de Economia e Custo-Benefício:
• Uma consulta particular avulsa na rede privada custa entre R$ 250,00 e R$ 450,00.
• Com o Vida Card por apenas R$ 89,90/mês para a família inteira, a consulta sai por apenas R$ 45,00.
• Logo na primeira ida ao médico, a economia supera a anuidade do plano!
• Não há reajuste por faixa etária abusivo como nos planos de saúde convencionais.
• Convide o lead para simular a economia da família dele no WhatsApp.`,
  },
  {
    id: 'documents',
    name: 'Políticas & Diretrizes',
    icon: '📋',
    tagColor: '#64748b',
    badgeBg: 'rgba(100, 116, 139, 0.12)',
    description: 'Termos contratuais, horários de plantão, unidades físicas e cancelamento.',
    placeholderTitle: 'Ex: Horários de Atendimento e Política de Cancelamento',
    exampleContent: `Informações Institucionais e Diretrizes:
• Horário de atendimento presencial das unidades: Segunda a sexta das 08h00 às 18h30; sábados das 08h00 às 12h00.
• Atendimento de urgência e telemedicina: 24 horas por dia, 7 dias por semana pelo app oficial.
• Cancelamento: Pode ser solicitado a qualquer momento sem burocracia após o período inicial de 3 meses, sem multas ocultas.`,
  },
];

export function KnowledgePage() {
  const { session, activeOrg } = useSession();

  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalCollection, setModalCollection] = useState('pricing');
  const [modalContent, setModalContent] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Semantic Search tester
  const [searchQuery, setSearchQuery] = useState('');
  const [searchThreshold, setSearchThreshold] = useState(0.3);
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Base URL & Headers detection
  const isStandalone = !activeOrg || !session?.access_token || activeOrg === 'standalone-org';
  const baseUrl = isStandalone ? '/api/knowledge' : `/api/organizations/${activeOrg}/knowledge`;
  const getHeaders = (hasBody = false): Record<string, string> => {
    const h: Record<string, string> = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  };

  useEffect(() => {
    loadDocuments();
  }, [activeOrg, session, selectedCollection]);

  async function loadDocuments() {
    setLoading(true);
    setError(null);
    try {
      const url =
        selectedCollection === 'all'
          ? baseUrl
          : `${baseUrl}?collection=${encodeURIComponent(selectedCollection)}`;

      const res = await fetch(url, { headers: getHeaders() });
      if (!res.ok) {
        throw new Error(`Falha ao carregar base de conhecimento (${res.status})`);
      }

      const data = (await res.json()) as KnowledgeDoc[];
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar documentos');
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingDocId(null);
    setModalCollection('pricing');
    setModalTitle('');
    setModalContent('');
    setModalError(null);
    setShowAddModal(true);
  }

  function openEditModal(doc: KnowledgeDoc) {
    setEditingDocId(doc.id);
    setModalCollection(doc.collection);
    setModalTitle(doc.title);
    setModalContent(doc.content);
    setModalError(null);
    setShowAddModal(true);
  }

  function applyExampleTemplate(colId: string) {
    const meta = COLLECTIONS.find(c => c.id === colId);
    if (!meta) return;
    setModalCollection(meta.id);
    setModalTitle(meta.placeholderTitle.replace(/^Ex:\s*/i, ''));
    setModalContent(meta.exampleContent);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!modalTitle.trim()) {
      setModalError('O título do documento é obrigatório.');
      return;
    }
    if (!modalContent.trim()) {
      setModalError('O conteúdo do documento não pode ficar vazio.');
      return;
    }

    setSaving(true);
    setModalError(null);
    try {
      const endpoint = editingDocId ? `${baseUrl}/${editingDocId}` : baseUrl;
      const method = editingDocId ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: getHeaders(true),
        body: JSON.stringify({
          collection: modalCollection,
          title: modalTitle.trim(),
          content: modalContent.trim(),
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Erro ao salvar documento (${res.status})`);
      }

      setShowAddModal(false);
      await loadDocuments();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao processar gravação');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Deseja realmente excluir o documento "${title}"?`)) return;

    try {
      const res = await fetch(`${baseUrl}/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });

      if (!res.ok) throw new Error('Falha ao excluir documento');
      await loadDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao excluir documento');
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const res = await fetch(`${baseUrl}/search`, {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({
          query: searchQuery.trim(),
          collection: selectedCollection === 'all' ? undefined : selectedCollection,
          threshold: searchThreshold,
          limit: 5,
        }),
      });

      if (!res.ok) throw new Error(`Falha na busca semântica (${res.status})`);
      const data = (await res.json()) as SearchHit[];
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro na busca');
    } finally {
      setSearching(false);
    }
  }

  // Helpers
  const totalTokens = documents.reduce((sum, d) => sum + (d.token_count || 0), 0);
  const getCollectionMeta = (colId: string) => COLLECTIONS.find(c => c.id === colId) || {
    id: colId,
    name: colId,
    icon: '📄',
    tagColor: '#64748b',
    badgeBg: 'rgba(100, 116, 139, 0.12)',
    description: 'Documentos gerais',
    placeholderTitle: 'Título do documento',
    exampleContent: '',
  };

  const currentMeta = getCollectionMeta(modalCollection);
  const wordCount = modalContent.trim() ? modalContent.trim().split(/\s+/).length : 0;
  const tokenEstimate = Math.max(1, Math.ceil((modalTitle.length + modalContent.length) / 4));

  return (
    <div className="page-content" style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 28,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <span
            className="eyebrow"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'var(--color-brand)',
              marginBottom: 4,
            }}
          >
            <BookOpen size={14} /> BASE DE CONHECIMENTO VETORIAL (RAG)
          </span>
          <h1 style={{ margin: '4px 0 8px', fontSize: 26, fontWeight: 700 }}>
            Base de Conhecimento do SDR
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 680 }}>
            Tabelas de valores, planos, especialidades, regras de carência e respostas para objeções.
            A IA consulta estes dados antes de responder aos clientes no WhatsApp, garantindo respostas com 100% de precisão e zero alucinações.
          </p>
        </div>

        <button
          type="button"
          className="primary"
          onClick={openCreateModal}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          <Plus size={18} /> Novo Documento
        </button>
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        <div
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 10,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: 'rgba(59, 130, 246, 0.12)',
              color: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Database size={22} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{documents.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Documentos Ativos</div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 10,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>~{totalTokens.toLocaleString()}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Tokens Indexados</div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 10,
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: 'rgba(139, 92, 246, 0.12)',
              color: '#8b5cf6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sparkles size={22} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{COLLECTIONS.length}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Categorias Oficiais</div>
          </div>
        </div>
      </div>

      {/* Semantic Search Tester Card */}
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 10,
          padding: 20,
          marginBottom: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Search size={18} style={{ color: 'var(--color-brand)' }} />
          <h2 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>
            Testador de Busca Semântica da IA
          </h2>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
            Simula como a IA encontra informações para responder ao cliente
          </span>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Digite uma pergunta real de cliente: ex: Quanto custa o plano familiar? Tem carência para dentista?"
            style={{ flex: 1, minWidth: 280 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, margin: 0, color: 'var(--color-text-secondary)' }}>Limiar:</label>
            <input
              type="number"
              min={0.1}
              max={0.99}
              step={0.05}
              value={searchThreshold}
              onChange={e => setSearchThreshold(parseFloat(e.target.value))}
              style={{ width: 68 }}
              title="Sensibilidade mínima de similaridade vetorial"
            />
          </div>
          <button type="submit" className="secondary" disabled={searching || !searchQuery.trim()}>
            {searching ? 'Pesquisando...' : 'Testar Busca'}
          </button>
        </form>

        {searchResults && (
          <div style={{ marginTop: 18, borderTop: '1px solid var(--color-border-secondary)', paddingTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Resultados Encontrados ({searchResults.length}):
              </h3>
              <button
                type="button"
                onClick={() => setSearchResults(null)}
                style={{ fontSize: 11, background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >
                Limpar resultados
              </button>
            </div>

            {searchResults.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', background: 'var(--color-bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Nenhum documento atingiu o limiar de similaridade de {(searchThreshold * 100).toFixed(0)}%. Tente diminuir o limiar ou adicionar informações sobre este tema.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {searchResults.map(hit => {
                  const meta = getCollectionMeta(hit.collection);
                  const simPct = Math.round(hit.similarity * 100);
                  const simColor = simPct >= 65 ? '#10b981' : simPct >= 40 ? '#f59e0b' : '#64748b';
                  return (
                    <div
                      key={hit.id}
                      style={{
                        padding: '12px 16px',
                        background: 'var(--color-bg-secondary)',
                        borderRadius: 8,
                        border: '1px solid var(--color-border-secondary)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14 }}>{meta.icon}</span>
                          <strong style={{ fontSize: 13 }}>{hit.title}</strong>
                          <span
                            style={{
                              fontSize: 10,
                              textTransform: 'uppercase',
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: meta.badgeBg,
                              color: meta.tagColor,
                              fontWeight: 700,
                            }}
                          >
                            {meta.name}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: simColor,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Check size={13} /> {simPct}% de correspondência
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12.5, whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        {hit.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collection Filters Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
        <button
          type="button"
          className={selectedCollection === 'all' ? 'primary' : 'secondary'}
          onClick={() => setSelectedCollection('all')}
          style={{ fontSize: 13, padding: '6px 14px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span>📁 Todas as Coleções</span>
          <span style={{ fontSize: 11, opacity: 0.8 }}>({documents.length})</span>
        </button>

        {COLLECTIONS.map(col => {
          const count = documents.filter(d => d.collection.toLowerCase() === col.id.toLowerCase()).length;
          return (
            <button
              key={col.id}
              type="button"
              className={selectedCollection === col.id ? 'primary' : 'secondary'}
              onClick={() => setSelectedCollection(col.id)}
              style={{ fontSize: 13, padding: '6px 14px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span>{col.icon} {col.name}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Document Grid or Empty State */}
      {error && (
        <div style={{ padding: 14, background: '#fee2e2', color: '#b91c1c', borderRadius: 8, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-secondary)' }}>
          Carregando base de conhecimento...
        </div>
      ) : documents.length === 0 ? (
        <div
          style={{
            border: '2px dashed var(--color-border-secondary)',
            borderRadius: 12,
            padding: '50px 24px',
            textAlign: 'center',
            background: 'var(--color-bg-surface)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(59, 130, 246, 0.1)',
              color: 'var(--color-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Database size={28} />
          </div>
          <h3 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>Nenhum documento cadastrado nesta categoria</h3>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.5 }}>
            Cadastre os preços dos seus planos, especialidades e respostas a dúvidas frequentes para que a IA atenda seus leads no WhatsApp de forma precisa.
          </p>
          <button
            type="button"
            className="primary"
            onClick={openCreateModal}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600 }}
          >
            <Plus size={16} /> Cadastrar Primeiro Documento
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {documents.map(doc => {
            const meta = getCollectionMeta(doc.collection);
            return (
              <div
                key={doc.id}
                style={{
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border-secondary)',
                  borderRadius: 10,
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: meta.badgeBg,
                        color: meta.tagColor,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span>{meta.icon}</span> {meta.name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      ~{doc.token_count} tokens
                    </span>
                  </div>

                  <h3 style={{ fontSize: 15, margin: '0 0 8px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {doc.title}
                  </h3>

                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--color-text-secondary)',
                      margin: 0,
                      lineHeight: 1.5,
                      maxHeight: 92,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {doc.content}
                  </p>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 16,
                    paddingTop: 12,
                    borderTop: '1px solid var(--color-border-secondary)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openEditModal(doc)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Edit3 size={13} /> Ver / Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id, doc.title)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: 6,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      title="Excluir documento"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODERN REDESIGNED ADD / EDIT MODAL */}
      {showAddModal && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div
            className="modal-content"
            style={{
              maxWidth: 740,
              width: '95%',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: 12,
              padding: '24px 28px',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 20,
                borderBottom: '1px solid var(--color-border-secondary)',
                paddingBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: 'rgba(59, 130, 246, 0.12)',
                    color: 'var(--color-brand)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <BookOpen size={24} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, margin: '0 0 4px', fontWeight: 700 }}>
                    {editingDocId ? 'Editar Documento de Conhecimento' : 'Novo Documento de Conhecimento'}
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    Alimente a IA com informações oficiais e verdadeiras para atendimento no WhatsApp.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 6,
                }}
                title="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            {modalError && (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#fee2e2',
                  color: '#b91c1c',
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={16} />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSave}>
              {/* Category Selector Cards */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  Selecione a Coleção / Categoria:
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: 10,
                  }}
                >
                  {COLLECTIONS.map(col => {
                    const isSelected = modalCollection === col.id;
                    return (
                      <div
                        key={col.id}
                        onClick={() => setModalCollection(col.id)}
                        style={{
                          border: isSelected
                            ? '2px solid var(--color-brand)'
                            : '1px solid var(--color-border-secondary)',
                          borderRadius: 8,
                          padding: '10px 12px',
                          cursor: 'pointer',
                          background: isSelected ? col.badgeBg : 'var(--color-bg-surface)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          position: 'relative',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 18 }}>{col.icon}</span>
                          {isSelected && (
                            <span
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: '50%',
                                background: 'var(--color-brand)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <Check size={11} />
                            </span>
                          )}
                        </div>
                        <strong style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{col.name}</strong>
                      </div>
                    );
                  })}
                </div>

                {/* Selected category tip */}
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 12px',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>
                    💡 <strong>{currentMeta.name}:</strong> {currentMeta.description}
                  </span>
                  {!editingDocId && (
                    <button
                      type="button"
                      onClick={() => applyExampleTemplate(modalCollection)}
                      style={{
                        border: 'none',
                        background: 'none',
                        color: 'var(--color-brand)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: 11,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Sparkles size={12} /> Carregar Exemplo Pronto
                    </button>
                  )}
                </div>
              </div>

              {/* Title Field */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Título do Documento ou Pergunta-Chave</label>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    Exclusivo e descritivo
                  </span>
                </div>
                <input
                  type="text"
                  required
                  value={modalTitle}
                  onChange={e => setModalTitle(e.target.value)}
                  placeholder={currentMeta.placeholderTitle}
                  style={{ width: '100%', fontSize: 14, padding: '10px 14px' }}
                />
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  Dica: Títulos claros e contextuais ajudam o algoritmo a encontrar o documento correto durante a conversa.
                </p>
              </div>

              {/* Content Textarea */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    Conteúdo Factual / Informações Oficiais
                  </label>
                  <span style={{ fontSize: 12, color: 'var(--color-brand)', fontWeight: 600 }}>
                    ~{wordCount} palavras • ~{tokenEstimate} tokens estimados
                  </span>
                </div>
                <textarea
                  required
                  rows={9}
                  value={modalContent}
                  onChange={e => setModalContent(e.target.value)}
                  placeholder="Escreva as informações em tópicos claros com valores em R$, prazos e condições exatas..."
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    padding: '12px 14px',
                  }}
                />
                <div
                  style={{
                    marginTop: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span>
                    A IA usará este texto como fonte inquestionável de verdade (Grounding) para não alucinar valores.
                  </span>
                  <span>Markdown suportado (•, -, #)</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 12,
                  borderTop: '1px solid var(--color-border-secondary)',
                  paddingTop: 16,
                }}
              >
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowAddModal(false)}
                  disabled={saving}
                  style={{ padding: '10px 18px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={saving}
                  style={{
                    padding: '10px 22px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: 600,
                  }}
                >
                  {saving ? (
                    'Gravando na Base...'
                  ) : editingDocId ? (
                    'Atualizar Documento'
                  ) : (
                    <>
                      <CheckCircle2 size={16} /> Salvar Documento
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
