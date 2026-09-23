import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  CreditCard,
  FileText,
  Folder,
  HelpCircle,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useSession } from '../session';
import {
  Button,
  CardGridSkeleton,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageContainer,
  PageHeader,
  Popover,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  confirmDialog,
  toast,
} from '../components/ui';
import { formatDate, formatRelative } from '../lib/format';

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
    icon: Stethoscope,
    tagColor: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.12)',
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
    icon: HelpCircle,
    tagColor: '#a855f7',
    badgeBg: 'rgba(168, 85, 247, 0.12)',
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
    icon: ShieldAlert,
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
    icon: FileText,
    tagColor: '#94a3b8',
    badgeBg: 'rgba(148, 163, 184, 0.12)',
    description: 'Termos contratuais, horários de plantão, unidades físicas e cancelamento.',
    placeholderTitle: 'Ex: Horários de Atendimento e Política de Cancelamento',
    exampleContent: `Informações Institucionais e Diretrizes:
• Horário de atendimento presencial das unidades: Segunda a sexta das 08h00 às 18h30; sábados das 08h00 às 12h00.
• Atendimento de urgência e telemedicina: 24 horas por dia, 7 dias por semana pelo app oficial.
• Cancelamento: Pode ser solicitado a qualquer momento sem burocracia após o período inicial de 3 meses, sem multas ocultas.`,
  },
];


const FALLBACK_META = (id: string): CollectionMeta => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  icon: FileText,
  tagColor: '#94a3b8',
  badgeBg: 'rgba(148, 163, 184, 0.12)',
  description: 'Documentos gerais.',
  placeholderTitle: 'Título do documento',
  exampleContent: '',
});

const getCollectionMeta = (id: string): CollectionMeta => COLLECTIONS.find(c => c.id === id) ?? FALLBACK_META(id);

/** Past this many documents, a list reads faster than cards. */
const LIST_FROM = 15;

type View = 'cards' | 'list';

export function KnowledgePage() {
  const { activeOrg, session } = useSession();

  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);

  // Editor
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalCollection, setModalCollection] = useState('pricing');
  const [modalContent, setModalContent] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Question tester
  const [searchQuery, setSearchQuery] = useState('');
  const [searchThreshold, setSearchThreshold] = useState(0.3);
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Knowledge is always organization-scoped. There is intentionally no local JSON fallback.
  const baseUrl = activeOrg ? `/api/organizations/${activeOrg}/knowledge` : null;
  const getHeaders = (hasBody = false): Record<string, string> => {
    const h: Record<string, string> = {};
    if (hasBody) h['Content-Type'] = 'application/json';
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  };

  useEffect(() => {
    void loadDocuments();
  }, [activeOrg, session?.access_token]);

  // All documents are loaded once so every collection count is right; the filter is local.
  async function loadDocuments() {
    if (!baseUrl || !session?.access_token) {
      setDocuments([]);
      setError('Selecione uma organização para acessar a base de conhecimento.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetch(baseUrl, { headers: getHeaders() });
      if (!res.ok) throw new Error(`Falha ao carregar a base de conhecimento (${res.status})`);
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
    setModalCollection(selectedCollection !== 'all' && COLLECTIONS.some(c => c.id === selectedCollection) ? selectedCollection : 'pricing');
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
    if (!baseUrl || !session?.access_token) {
      setModalError('Selecione uma organização antes de salvar um documento.');
      return;
    }
    if (!modalTitle.trim()) {
      setModalError('Dê um título ao documento.');
      return;
    }
    if (!modalContent.trim()) {
      setModalError('Escreva o conteúdo do documento.');
      return;
    }

    setSaving(true);
    setModalError(null);
    try {
      const endpoint = editingDocId ? `${baseUrl}/${editingDocId}` : baseUrl;
      const res = await fetch(endpoint, {
        method: editingDocId ? 'PATCH' : 'POST',
        headers: getHeaders(true),
        body: JSON.stringify({ collection: modalCollection, title: modalTitle.trim(), content: modalContent.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Erro ao salvar documento (${res.status})`);
      }
      setShowAddModal(false);
      toast.success(editingDocId ? 'Documento atualizado' : 'Documento adicionado');
      await loadDocuments();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Erro ao salvar o documento');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(doc: KnowledgeDoc) {
    const ok = await confirmDialog({
      title: `Excluir "${doc.title}"?`,
      description: 'A IA deixa de usar este documento nas respostas.',
      confirmLabel: 'Excluir documento',
      danger: true,
    });
    if (!ok || !baseUrl || !session?.access_token) return;
    try {
      const res = await fetch(`${baseUrl}/${doc.id}`, { method: 'DELETE', headers: getHeaders() });
      if (!res.ok) throw new Error('Falha ao excluir o documento');
      toast.success('Documento excluído');
      await loadDocuments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir o documento');
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim() || !baseUrl || !session?.access_token) return;
    setSearching(true);
    setSearchError(null);
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
      if (!res.ok) throw new Error(`A busca falhou (${res.status})`);
      const data = (await res.json()) as SearchHit[];
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erro na busca');
    } finally {
      setSearching(false);
    }
  }

  const collections = useMemo(() => {
    const extra = Array.from(new Set(documents.map(d => d.collection))).filter(id => !COLLECTIONS.some(c => c.id === id));
    return [...COLLECTIONS, ...extra.map(FALLBACK_META)].map(meta => ({
      meta,
      count: documents.filter(d => d.collection === meta.id).length,
    }));
  }, [documents]);

  const visible = selectedCollection === 'all' ? documents : documents.filter(d => d.collection === selectedCollection);
  const effectiveView: View = view ?? (visible.length > LIST_FROM ? 'list' : 'cards');
  const lastUpdate = documents.reduce<string | null>((latest, d) => {
    const at = (d as KnowledgeDoc & { updated_at?: string }).updated_at ?? d.created_at;
    return !latest || at > latest ? at : latest;
  }, null);
  const wordCount = modalContent.trim() ? modalContent.trim().split(/\s+/).length : 0;
  const currentMeta = getCollectionMeta(modalCollection);

  const docMenu = (doc: KnowledgeDoc) => (
    <DropdownMenu
      aria-label={`Ações de ${doc.title}`}
      items={[
        { label: 'Editar', icon: <Pencil size={14} />, onSelect: () => openEditModal(doc) },
        { type: 'separator' },
        { label: 'Excluir…', icon: <Trash2 size={14} />, danger: true, onSelect: () => void handleDelete(doc) },
      ]}
      trigger={<IconButton label="Mais ações" icon={<MoreHorizontal size={16} />} size="sm" tooltip={false} />}
    />
  );

  const tester = (
    <Popover
      align="end"
      width={440}
      className="p-0"
      trigger={
        <Button variant="outline">
          <Search size={15} /> Testar pergunta
        </Button>
      }
    >
      <div className="flex max-h-[70vh] flex-col">
        <form onSubmit={handleSearch} className="border-b border-border p-3">
          <p className="m-0 mb-2 text-xs text-content-secondary">
            Escreva uma pergunta como um lead faria e veja quais documentos a IA usaria para responder.
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Ex.: Tem carência para dentista?"
                aria-label="Pergunta de teste"
              />
            </div>
            <Button type="submit" variant="primary" loading={searching} disabled={!searchQuery.trim()}>
              Testar
            </Button>
          </div>
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced(v => !v)}
            className="mt-2 flex min-h-0 items-center gap-1 border-0 bg-transparent p-0 text-2xs font-medium text-content-muted hover:text-content"
          >
            <ChevronRight size={12} className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`} /> Avançado
          </button>
          {showAdvanced && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-2xs text-content-secondary">
                <span>Semelhança mínima</span>
                <span className="tabular-nums text-content">{Math.round(searchThreshold * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={searchThreshold}
                onChange={e => setSearchThreshold(parseFloat(e.target.value))}
                aria-label="Semelhança mínima"
                className="range-input w-full"
              />
              <p className="m-0 text-2xs text-content-muted">Mais alto traz menos documentos, só os muito parecidos com a pergunta.</p>
            </div>
          )}
          {selectedCollection !== 'all' && (
            <p className="m-0 mt-2 text-2xs text-content-muted">Buscando só em {getCollectionMeta(selectedCollection).name}.</p>
          )}
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="polite">
          {searching ? (
            <div className="space-y-2">
              {[0, 1].map(i => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <Skeleton className="mb-2 h-4 w-32" />
                  <SkeletonText lines={2} />
                </div>
              ))}
            </div>
          ) : searchError ? (
            <p className="m-0 text-xs text-danger">{searchError}</p>
          ) : searchResults === null ? (
            <p className="m-0 text-center text-2xs text-content-muted">Os resultados aparecem aqui.</p>
          ) : searchResults.length === 0 ? (
            <p className="m-0 text-xs text-content-secondary">
              Nenhum documento responde a esta pergunta. Adicione um documento sobre o tema ou reduza a semelhança mínima em Avançado.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {searchResults.map(hit => {
                const pct = Math.round(hit.similarity * 100);
                return (
                  <li key={hit.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate text-xs text-content">{hit.title}</strong>
                      <span className="flex-shrink-0 text-2xs tabular-nums text-content-secondary">{pct}% parecido</span>
                    </div>
                    <p className="m-0 mt-0.5 text-2xs text-content-muted">{getCollectionMeta(hit.collection).name}</p>
                    <p className="m-0 mt-1.5 line-clamp-3 text-xs leading-relaxed text-content-secondary">{hit.content}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Popover>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Base de Conhecimento"
        description={
          loading
            ? 'Carregando…'
            : documents.length === 0
            ? 'Preços, planos e respostas que a IA consulta antes de responder no WhatsApp.'
            : `${documents.length} ${documents.length === 1 ? 'documento' : 'documentos'}${lastUpdate ? ` · atualizado ${formatRelative(lastUpdate)}` : ''} · a IA consulta estes textos antes de responder`
        }
        actions={
          <>
            {documents.length > 0 && tester}
            <Button variant="primary" onClick={openCreateModal}>
              <Plus size={16} /> Novo documento
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        {/* Collections as folders: they scale, and the empty ones stay visible but quiet. */}
        <nav aria-label="Coleções" className="flex gap-1 overflow-x-auto md:flex-col md:self-start">
          {[{ meta: { id: 'all', name: 'Todas', icon: Folder } as Pick<CollectionMeta, 'id' | 'name' | 'icon'>, count: documents.length }, ...collections].map(
            ({ meta, count }) => {
              const active = selectedCollection === meta.id;
              const Icon = meta.icon;
              return (
                <button
                  key={meta.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSelectedCollection(meta.id)}
                  className={`flex h-8 min-h-0 flex-shrink-0 items-center justify-start gap-2 whitespace-nowrap rounded-lg border-0 px-2.5 text-left text-xs ${
                    active
                      ? 'bg-surface-elevated font-semibold text-content'
                      : count === 0
                      ? 'bg-transparent text-content-muted hover:bg-surface-elevated hover:text-content'
                      : 'bg-transparent text-content-secondary hover:bg-surface-elevated hover:text-content'
                  }`}
                >
                  <Icon size={14} className="flex-shrink-0 text-content-muted" />
                  <span className="flex-1 truncate">{meta.name}</span>
                  <span className="tabular-nums text-2xs text-content-muted">{count}</span>
                </button>
              );
            }
          )}
        </nav>

        <section className="min-w-0">
          {visible.length > 0 && (
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="m-0 text-xs text-content-secondary">
                {selectedCollection === 'all' ? 'Todos os documentos' : getCollectionMeta(selectedCollection).description}
              </p>
              <SegmentedControl<View>
                size="sm"
                aria-label="Visualização"
                value={effectiveView}
                onChange={setView}
                options={[
                  { value: 'cards', label: <LayoutGrid size={14} aria-label="Cards" /> },
                  { value: 'list', label: <List size={14} aria-label="Lista" /> },
                ]}
              />
            </div>
          )}

          {loading ? (
            <CardGridSkeleton />
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border">
              <EmptyState
                icon={<FileText size={20} />}
                title={selectedCollection === 'all' ? 'Nenhum documento ainda' : `Nada em ${getCollectionMeta(selectedCollection).name}`}
                description="Cadastre preços, planos, especialidades e respostas a dúvidas frequentes. A IA usa estes textos como fonte para responder os leads."
                action={
                  <Button variant="primary" onClick={openCreateModal}>
                    <Plus size={16} /> Adicionar documento
                  </Button>
                }
              />
            </div>
          ) : effectiveView === 'cards' ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {visible.map(doc => (
                <article
                  key={doc.id}
                  className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-[border-color,box-shadow] duration-200 ease-out hover:border-border-strong hover:shadow-elevated"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(doc)}
                      className="min-h-0 flex-1 justify-start border-0 bg-transparent p-0 text-left text-sm font-semibold text-content outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:bg-transparent focus-visible:after:ring-2 focus-visible:after:ring-brand/40"
                    >
                      <span className="line-clamp-1">{doc.title}</span>
                    </button>
                    <div className="relative z-10 -mr-1 -mt-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                      {docMenu(doc)}
                    </div>
                  </div>
                  <p className="m-0 mt-1.5 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-content-secondary">{doc.content}</p>
                  <p className="m-0 mt-auto pt-3 text-2xs text-content-muted">
                    {selectedCollection === 'all' && <>{getCollectionMeta(doc.collection).name} · </>}
                    adicionado {formatDate(doc.created_at)}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-border text-2xs text-content-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Título</th>
                    {selectedCollection === 'all' && <th className="hidden px-4 py-2 font-medium sm:table-cell">Coleção</th>}
                    <th className="hidden px-4 py-2 font-medium sm:table-cell">Adicionado</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(doc => (
                    <tr
                      key={doc.id}
                      tabIndex={0}
                      onClick={() => openEditModal(doc)}
                      onKeyDown={e => e.key === 'Enter' && openEditModal(doc)}
                      className="group cursor-pointer border-b border-border last:border-0 hover:bg-surface-elevated focus:bg-surface-elevated focus:outline-none"
                    >
                      <td className="max-w-0 px-4 py-2.5">
                        <p className="m-0 truncate font-medium text-content">{doc.title}</p>
                        <p className="m-0 truncate text-2xs text-content-muted">{doc.content}</p>
                      </td>
                      {selectedCollection === 'all' && (
                        <td className="hidden whitespace-nowrap px-4 py-2.5 text-content-secondary sm:table-cell">{getCollectionMeta(doc.collection).name}</td>
                      )}
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-content-secondary sm:table-cell">{formatDate(doc.created_at)}</td>
                      <td className="px-2" onClick={e => e.stopPropagation()}>
                        {docMenu(doc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={showAddModal}
        onClose={() => !saving && setShowAddModal(false)}
        maxWidth="2xl"
        title={editingDocId ? 'Editar documento' : 'Novo documento'}
        description="A IA usa este texto como fonte para responder. Escreva valores, prazos e condições exatamente como devem ser ditos."
      >
        <form id="knowledge-form" onSubmit={handleSave} className="space-y-4">
          {modalError && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle size={16} className="shrink-0" />
              <span>{modalError}</span>
            </div>
          )}

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 p-0 text-xs font-medium text-content-secondary">Coleção</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              {COLLECTIONS.map(col => {
                const selected = modalCollection === col.id;
                return (
                  <button
                    key={col.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setModalCollection(col.id)}
                    className={`relative flex min-h-0 flex-col items-start justify-start gap-1.5 rounded-lg border p-2.5 text-left transition-colors duration-150 ease-out ${
                      selected ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-border bg-surface hover:bg-surface-elevated'
                    }`}
                  >
                    <col.icon size={16} className={selected ? 'text-brand-fg' : 'text-content-muted'} />
                    <span className="text-xs font-medium leading-tight text-content">{col.name}</span>
                    {selected && <Check size={13} className="absolute right-2 top-2 text-brand-fg" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-col gap-1 text-2xs text-content-muted sm:flex-row sm:items-center sm:justify-between">
              <span>{currentMeta.description}</span>
              {!editingDocId && currentMeta.exampleContent && (
                <button
                  type="button"
                  onClick={() => applyExampleTemplate(modalCollection)}
                  className="flex min-h-0 flex-shrink-0 items-center gap-1 border-0 bg-transparent p-0 text-2xs font-semibold text-content-secondary hover:text-content"
                >
                  <Sparkles size={12} /> Usar exemplo
                </button>
              )}
            </div>
          </fieldset>

          <Input
            label="Título"
            required
            value={modalTitle}
            onChange={e => setModalTitle(e.target.value)}
            placeholder={currentMeta.placeholderTitle}
            helperText="Um título claro ajuda a IA a achar o documento certo."
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="knowledge-content" className="text-xs font-medium text-content-secondary">
              Conteúdo
            </label>
            <textarea
              id="knowledge-content"
              required
              value={modalContent}
              onChange={e => setModalContent(e.target.value)}
              placeholder="Escreva em tópicos, com valores em R$, prazos e condições exatas…"
              className="min-h-[280px] w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed text-content outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <div className="flex justify-between text-2xs text-content-muted">
              <span>Aceita listas com • ou -</span>
              <span className="tabular-nums">
                {wordCount.toLocaleString('pt-BR')} {wordCount === 1 ? 'palavra' : 'palavras'}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editingDocId ? 'Salvar' : 'Adicionar documento'}
            </Button>
          </div>
        </form>
      </Modal>
    </PageContainer>
  );
}
