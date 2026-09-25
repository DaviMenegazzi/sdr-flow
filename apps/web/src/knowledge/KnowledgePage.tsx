import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  CreditCard,
  Stethoscope,
  ShieldAlert,
  Folder,
  Lightbulb,
  Building2,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import { useSession } from '../session';
import { Button, Badge, Card, Input, CardGridSkeleton, Skeleton, SkeletonText, Tabs } from '../components/ui';
import { useTraining } from '../training/useTraining';
import { FactsPanel, ProfileSummary, TestPanel, TrainingError } from '../training/TrainingPanels';

type KnowledgeTab = 'documents' | 'profile' | 'facts' | 'test';
const KNOWLEDGE_TABS: KnowledgeTab[] = ['documents', 'profile', 'facts', 'test'];

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
  icon: LucideIcon;
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
    icon: CreditCard,
    tagColor: '#2ee86b',
    badgeBg: 'rgba(46, 232, 107, 0.12)',
    description: 'Preços, taxas, condições de pagamento e validade das ofertas.',
    placeholderTitle: 'Ex: Preços e condições atualizados',
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
    icon: Stethoscope,
    tagColor: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.12)',
    description: 'Produtos, serviços, características e áreas atendidas.',
    placeholderTitle: 'Ex: Produtos e serviços disponíveis',
    exampleContent: `Especialidades e Cobertura de Atendimento:
• Médicos especialistas: Clínica Geral, Pediatria, Ginecologia/Obstetrícia, Ortopedia, Oftalmologia, Cardiologia e Dermatologia.
• Odontologia: Avaliação, profilaxia (limpeza), restaurações e tratamento de canal com valores reduzidos.
• Exames laboratoriais: Hemograma completo, glicemia, colesterol, exames hormonais e urina.
• Exames de imagem: Ultrassonografia simples e com doppler, Raio-X digital e Eletrocardiograma.`,
  },
  {
    id: 'faq',
    name: 'Dúvidas & FAQ',
    icon: HelpCircle,
    tagColor: '#a855f7',
    badgeBg: 'rgba(168, 85, 247, 0.12)',
    description: 'Perguntas comuns dos clientes e respostas confirmadas.',
    placeholderTitle: 'Ex: Como funciona o atendimento?',
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
    icon: ShieldAlert,
    tagColor: '#f59e0b',
    badgeBg: 'rgba(245, 158, 11, 0.12)',
    description: 'Respostas a dúvidas e objeções comuns durante a venda.',
    placeholderTitle: 'Ex: Como responder à dúvida sobre preço',
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
    icon: FileText,
    tagColor: '#94a3b8',
    badgeBg: 'rgba(148, 163, 184, 0.12)',
    description: 'Termos, horários, localização e políticas da empresa.',
    placeholderTitle: 'Ex: Horários e política de cancelamento',
    exampleContent: `Informações Institucionais e Diretrizes:
• Horário de atendimento presencial das unidades: Segunda a sexta das 08h00 às 18h30; sábados das 08h00 às 12h00.
• Atendimento de urgência e telemedicina: 24 horas por dia, 7 dias por semana pelo app oficial.
• Cancelamento: Pode ser solicitado a qualquer momento sem burocracia após o período inicial de 3 meses, sem multas ocultas.`,
  },
];

export function KnowledgePage() {
  const { activeOrg, session } = useSession();
  const training = useTraining();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as KnowledgeTab | null;
  const tab: KnowledgeTab = requestedTab && KNOWLEDGE_TABS.includes(requestedTab) ? requestedTab : 'documents';
  const changeTab = (next: KnowledgeTab) => setSearchParams(next === 'documents' ? {} : { tab: next }, { replace: true });

  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [loading, setLoading] = useState(true);
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

  // Knowledge is always organization-scoped. There is intentionally no local JSON fallback.
  const baseUrl = activeOrg ? `/api/organizations/${activeOrg}/knowledge` : null;
  const getHeaders = (hasBody = false): Record<string, string> => {
    const h: Record<string, string> = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  };

  useEffect(() => {
    loadDocuments();
  }, [activeOrg, session?.access_token, selectedCollection]);

  async function loadDocuments() {
    if (!baseUrl || !session?.access_token) {
      setDocuments([]);
      setError('Selecione uma organização para acessar a base de conhecimento.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let url =
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!baseUrl || !session?.access_token) {
      setModalError('Selecione uma organização antes de salvar um documento.');
      return;
    }
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
    if (!baseUrl || !session?.access_token) {
      alert('Selecione uma organização antes de excluir um documento.');
      return;
    }

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
    if (!baseUrl || !session?.access_token) {
      alert('Selecione uma organização antes de pesquisar a base de conhecimento.');
      return;
    }

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
  const getCollectionMeta = (colId: string): CollectionMeta => COLLECTIONS.find(c => c.id === colId) || {
    id: colId,
    name: colId,
    icon: FileText,
    tagColor: '#94a3b8',
    badgeBg: 'rgba(148, 163, 184, 0.12)',
    description: 'Documentos gerais',
    placeholderTitle: 'Título do documento',
    exampleContent: '',
  };

  const currentMeta = getCollectionMeta(modalCollection);
  const wordCount = modalContent.trim() ? modalContent.trim().split(/\s+/).length : 0;
  const tokenEstimate = Math.max(1, Math.ceil((modalTitle.length + modalContent.length) / 4));

  return (
    <div className="h-full overflow-y-auto p-6 md:p-8 bg-canvas text-content">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-brand mb-1">
              <BookOpen className="w-3.5 h-3.5" /> BASE DE CONHECIMENTO VETORIAL (RAG)
            </div>
            <h1 className="text-2xl font-bold text-content tracking-tight">
              Base de Conhecimento do SDR
            </h1>
            <p className="text-sm text-content-secondary max-w-2xl mt-1">
              Cadastre informações confirmadas sobre produtos, preços, políticas e dúvidas frequentes.
              O agente consulta os trechos relevantes durante o atendimento.
            </p>
          </div>

          {tab === 'documents' && <Button
            type="button"
            variant="primary"
            onClick={openCreateModal}
            className="self-start sm:self-auto shrink-0 shadow-sm"
          >
            <Plus className="w-4 h-4" /> Novo Documento
          </Button>}
        </div>

        <Tabs<KnowledgeTab>
          activeTab={tab}
          onChange={changeTab}
          className="overflow-x-auto"
          tabs={[
            { id: 'documents', label: 'Documentos', icon: <Database className="w-3.5 h-3.5" />, badge: documents.length },
            { id: 'profile', label: 'Perfil do SDR', icon: <Building2 className="w-3.5 h-3.5" /> },
            { id: 'facts', label: 'Fatos', icon: <CheckCircle2 className="w-3.5 h-3.5" />, badge: training.loading ? undefined : training.approvedFacts },
            { id: 'test', label: 'Testar SDR', icon: <FlaskConical className="w-3.5 h-3.5" /> },
          ]}
        />

        {tab !== 'documents' && <TrainingError message={training.error} />}
        {tab !== 'documents' && training.loading && <CardGridSkeleton />}
        {tab === 'profile' && !training.loading && (training.hasProfile
          ? <ProfileSummary training={training} />
          : <Card className="py-14 px-6 text-center border-dashed">
            <div className="w-12 h-12 rounded-full bg-brand-subtle text-brand flex items-center justify-center mx-auto mb-3"><Sparkles className="w-6 h-6" /></div>
            <h3 className="text-base font-semibold text-content mb-1.5">O SDR ainda não foi treinado</h3>
            <p className="text-sm text-content-secondary max-w-md mx-auto mb-5 leading-relaxed">Responda algumas perguntas sobre a sua empresa e a forma de vender. Leva cerca de 5 minutos.</p>
            {training.canEdit && <Button variant="primary" onClick={() => navigate('/onboarding')}><Sparkles className="w-4 h-4" /> Treinar meu SDR</Button>}
          </Card>)}
        {tab === 'facts' && !training.loading && <FactsPanel training={training} />}
        {tab === 'test' && !training.loading && <Card className="p-5"><TestPanel training={training} /></Card>}

        {tab === 'documents' && <>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-info/10 text-info flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-content">{documents.length}</div>
              <div className="text-xs text-content-secondary">Documentos Ativos</div>
            </div>
          </Card>

          <Card className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-content">~{totalTokens.toLocaleString()}</div>
              <div className="text-xs text-content-secondary">Tokens Indexados</div>
            </div>
          </Card>

          <Card className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-2xl font-bold text-content">{COLLECTIONS.length}</div>
              <div className="text-xs text-content-secondary">Categorias Oficiais</div>
            </div>
          </Card>
        </div>

        {/* Semantic Search Tester Card */}
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-brand" />
              <h2 className="text-sm font-semibold text-content">
                Testador de Busca Semântica da IA
              </h2>
            </div>
            <span className="text-xs text-content-muted hidden sm:inline">
              Simula como a IA encontra informações para responder ao cliente
            </span>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2.5 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <Input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Digite uma pergunta real de cliente: ex: Quanto custa o plano familiar? Tem carência para dentista?"
              />
            </div>
            <div className="flex items-center gap-2 bg-surface-secondary px-3 py-1.5 rounded-lg border border-border">
              <label className="text-xs text-content-secondary">Limiar:</label>
              <input
                type="number"
                min={0.1}
                max={0.99}
                step={0.05}
                value={searchThreshold}
                onChange={e => setSearchThreshold(parseFloat(e.target.value))}
                className="w-14 px-1.5 py-0.5 text-xs bg-surface border border-border rounded text-content text-center focus:outline-none focus:ring-1 focus:ring-brand"
                title="Sensibilidade mínima de similaridade vetorial"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={searching || !searchQuery.trim()}
            >
              {searching ? 'Pesquisando...' : 'Testar Busca'}
            </Button>
          </form>

          {searching ? (
            <div role="status" aria-live="polite" className="mt-4 space-y-2.5 border-t border-border pt-4">
              <span className="sr-only">Pesquisando na base de conhecimento…</span>
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="rounded-lg border border-border/60 bg-surface-elevated p-3.5" aria-hidden="true">
                  <div className="mb-3 flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-12" rounded="full" />
                  </div>
                  <SkeletonText lines={2} />
                </div>
              ))}
            </div>
          ) : searchResults && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
                  Resultados Encontrados ({searchResults.length}):
                </h3>
                <button
                  type="button"
                  onClick={() => setSearchResults(null)}
                  className="text-xs text-content-muted hover:text-content transition-colors"
                >
                  Limpar resultados
                </button>
              </div>

              {searchResults.length === 0 ? (
                <div className="p-4 text-center bg-surface-secondary rounded-lg text-xs text-content-secondary border border-border/60">
                  Nenhum documento atingiu o limiar de similaridade de {(searchThreshold * 100).toFixed(0)}%. Tente diminuir o limiar ou adicionar informações sobre este tema.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {searchResults.map(hit => {
                    const meta = getCollectionMeta(hit.collection);
                    const simPct = Math.round(hit.similarity * 100);
                    const isHigh = simPct >= 65;
                    const isMid = simPct >= 40;
                    return (
                      <div
                        key={hit.id}
                        className="p-3.5 bg-surface-secondary rounded-lg border border-border/60"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-2">
                            <meta.icon className="w-3.5 h-3.5" style={{ color: meta.tagColor }} />
                            <strong className="text-xs text-content">{hit.title}</strong>
                            <span
                              className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded"
                              style={{ background: meta.badgeBg, color: meta.tagColor }}
                            >
                              {meta.name}
                            </span>
                          </div>
                          <Badge variant={isHigh ? 'success' : isMid ? 'warning' : 'default'} size="sm">
                            <Check className="w-3 h-3 mr-1" /> {simPct}% de correspondência
                          </Badge>
                        </div>
                        <p className="text-xs text-content-secondary leading-relaxed whitespace-pre-wrap">
                          {hit.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Collection Filters Bar */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            onClick={() => setSelectedCollection('all')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              selectedCollection === 'all'
                ? 'bg-brand text-black font-semibold shadow-xs'
                : 'bg-surface border border-border text-content-secondary hover:text-content hover:bg-surface-hover'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>Todas as Coleções</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${selectedCollection === 'all' ? 'bg-black/20 text-black font-bold' : 'bg-surface-secondary text-content-muted'}`}>
              {documents.length}
            </span>
          </button>

          {COLLECTIONS.map(col => {
            const isSelected = selectedCollection === col.id;
            const count = documents.filter(d => d.collection.toLowerCase() === col.id.toLowerCase()).length;
            const ColIcon = col.icon;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => setSelectedCollection(col.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
                  isSelected
                    ? 'bg-brand text-black font-semibold shadow-xs'
                    : 'bg-surface border border-border text-content-secondary hover:text-content hover:bg-surface-hover'
                }`}
              >
                <ColIcon className="w-3.5 h-3.5" />
                <span>{col.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-black/20 text-black font-bold' : 'bg-surface-secondary text-content-muted'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Document Grid or Empty State */}
        {error && (
          <div className="p-3.5 rounded-lg bg-danger-bg border border-danger-border text-danger text-sm flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <CardGridSkeleton />
        ) : documents.length === 0 ? (
          <Card className="py-14 px-6 text-center border-dashed">
            <div className="w-12 h-12 rounded-full bg-brand-subtle text-brand flex items-center justify-center mx-auto mb-3">
              <Database className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-content mb-1.5">
              Nenhum documento cadastrado nesta categoria
            </h3>
            <p className="text-sm text-content-secondary max-w-md mx-auto mb-5 leading-relaxed">
              Cadastre os preços dos seus planos, especialidades e respostas a dúvidas frequentes para que a IA atenda seus leads no WhatsApp de forma precisa.
            </p>
            <Button variant="primary" onClick={openCreateModal}>
              <Plus className="w-4 h-4" /> Cadastrar Primeiro Documento
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map(doc => {
              const meta = getCollectionMeta(doc.collection);
              return (
                <Card
                  key={doc.id}
                  className="p-5 flex flex-col justify-between hover:border-border-hover transition-colors shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span
                        className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded flex items-center gap-1.5"
                        style={{ background: meta.badgeBg, color: meta.tagColor }}
                      >
                        <meta.icon className="w-3 h-3" /> {meta.name}
                      </span>
                      <span className="text-xs text-content-muted">
                        ~{doc.token_count} tokens
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-content mb-2 line-clamp-1">
                      {doc.title}
                    </h3>

                    <p className="text-xs text-content-secondary line-clamp-4 whitespace-pre-wrap leading-relaxed">
                      {doc.content}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-4 border-t border-border/60">
                    <span className="text-[11px] text-content-muted">
                      {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                    </span>

                    {doc.metadata?.training_fact_id ? <button type="button" onClick={() => changeTab('facts')} className="text-[11px] font-medium text-brand hover:underline">Gerenciar em Fatos</button> : <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(doc)}
                        className="text-xs h-7 px-2.5"
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1" /> Editar
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id, doc.title)}
                        className="p-1.5 rounded text-content-muted hover:text-danger hover:bg-danger-bg transition-colors"
                        title="Excluir documento"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        </>}

        {/* MODERN REDESIGNED ADD / EDIT MODAL */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 flex flex-col">
              {/* Modal Header */}
              <div className="flex items-start justify-between pb-4 border-b border-border mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-content">
                      {editingDocId ? 'Editar Documento de Conhecimento' : 'Novo Documento de Conhecimento'}
                    </h2>
                    <p className="text-xs text-content-secondary mt-0.5">
                      Alimente a IA com informações oficiais e verdadeiras para atendimento no WhatsApp.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 rounded-lg text-content-muted hover:text-content hover:bg-surface-secondary transition-colors"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-danger-bg border border-danger-border text-danger text-xs flex items-center gap-2 mb-4">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <form onSubmit={handleSave} className="space-y-4">
                {/* Category Selector Cards */}
                <div>
                  <label className="text-xs font-semibold text-content block mb-2">
                    Selecione a Coleção / Categoria:
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    {COLLECTIONS.map(col => {
                      const isSelected = modalCollection === col.id;
                      return (
                        <div
                          key={col.id}
                          onClick={() => setModalCollection(col.id)}
                          className={`p-2.5 rounded-lg border cursor-pointer flex flex-col gap-1 transition-all ${
                            isSelected
                              ? 'border-brand ring-1 ring-brand bg-brand-subtle'
                              : 'border-border bg-surface hover:bg-surface-hover'
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <col.icon className="w-5 h-5 text-brand" />
                            {isSelected && (
                              <span className="w-4 h-4 rounded-full bg-brand text-black flex items-center justify-center text-[10px]">
                                <Check className="w-3 h-3 stroke-[2.5]" />
                              </span>
                            )}
                          </div>
                          <strong className="text-xs text-content font-medium leading-tight mt-1">{col.name}</strong>
                        </div>
                      );
                    })}
                  </div>

                  {/* Selected category tip */}
                  <div className="mt-2.5 p-2.5 bg-surface-secondary border border-border/60 rounded-lg text-xs text-content-secondary flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-brand shrink-0" />
                      <span><strong className="text-content">{currentMeta.name}:</strong> {currentMeta.description}</span>
                    </span>
                  </div>
                </div>

                {/* Title Field */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-content">Título do Documento ou Pergunta-Chave</label>
                    <span className="text-[11px] text-content-muted">Exclusivo e descritivo</span>
                  </div>
                  <Input
                    type="text"
                    required
                    value={modalTitle}
                    onChange={e => setModalTitle(e.target.value)}
                    placeholder={currentMeta.placeholderTitle}
                  />
                  <p className="mt-1 text-[11px] text-content-muted">
                    Dica: Títulos claros e contextuais ajudam o algoritmo a encontrar o documento correto durante a conversa.
                  </p>
                </div>

                {/* Content Textarea */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-content">
                      Conteúdo Factual / Informações Oficiais
                    </label>
                    <span className="text-xs text-brand font-medium">
                      ~{wordCount} palavras • ~{tokenEstimate} tokens estimados
                    </span>
                  </div>
                  <textarea
                    required
                    rows={8}
                    value={modalContent}
                    onChange={e => setModalContent(e.target.value)}
                    placeholder="Escreva as informações em tópicos claros com valores em R$, prazos e condições exatas..."
                    className="w-full bg-surface border border-border rounded-lg text-content p-3 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-success-border focus:border-brand resize-y font-mono"
                  />
                  <div className="mt-1.5 flex justify-between items-center text-[11px] text-content-muted">
                    <span>Revise preços e condições antes de salvar. O agente pode usar este conteúdo como referência.</span>
                    <span>Markdown suportado (•, -, #)</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-2.5 pt-4 border-t border-border">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAddModal(false)}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={saving}
                  >
                    {editingDocId ? 'Atualizar Documento' : 'Salvar Documento'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
