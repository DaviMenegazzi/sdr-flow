import { useState, useEffect } from 'react';
import { BookOpen, Plus, Search, Trash2, FileText, CheckCircle2, Tag, Layers, Database } from 'lucide-react';
import { useSession } from '../session';

interface KnowledgeDoc {
  id: string;
  collection: string;
  title: string;
  content: string;
  token_count: number;
  created_at: string;
}

interface SearchHit {
  id: string;
  collection: string;
  title: string;
  content: string;
  similarity: number;
}

export function KnowledgePage() {
  const { session, activeOrg } = useSession();

  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Document modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCollection, setNewCollection] = useState('pricing');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Semantic Search tester
  const [searchQuery, setSearchQuery] = useState('');
  const [searchThreshold, setSearchThreshold] = useState(0.5);
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!session || !activeOrg) return;
    loadDocuments();
  }, [session, activeOrg, selectedCollection]);

  async function loadDocuments() {
    setLoading(true);
    setError(null);
    try {
      const url =
        selectedCollection === 'all'
          ? `/api/organizations/${activeOrg}/knowledge`
          : `/api/organizations/${activeOrg}/knowledge?collection=${selectedCollection}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (!res.ok) {
        throw new Error('Falha ao carregar documentos da base de conhecimento');
      }

      const data = (await res.json()) as KnowledgeDoc[];
      setDocuments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/knowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          collection: newCollection,
          title: newTitle,
          content: newContent,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'Falha ao salvar documento');
      }

      setShowAddModal(false);
      setNewTitle('');
      setNewContent('');
      await loadDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao criar documento');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deseja excluir este documento da base de conhecimento?')) return;

    try {
      const res = await fetch(`/api/organizations/${activeOrg}/knowledge/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (!res.ok) throw new Error('Falha ao excluir documento');
      await loadDocuments();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const res = await fetch(`/api/organizations/${activeOrg}/knowledge/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          query: searchQuery,
          collection: selectedCollection === 'all' ? undefined : selectedCollection,
          threshold: searchThreshold,
          limit: 5,
        }),
      });

      if (!res.ok) throw new Error('Falha na busca semântica');
      const data = (await res.json()) as SearchHit[];
      setSearchResults(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro na busca');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="page-content" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={14} /> CONTEXTO & CONHECIMENTO
          </span>
          <h1 style={{ margin: '4px 0 8px', fontSize: 24 }}>Base de Conhecimento</h1>
          <p className="muted" style={{ margin: 0 }}>
            Catálogo, tabelas de preços, objeções e documentos consultados pelo nó{' '}
            <code>context.knowledge</code>.
          </p>
        </div>

        <button
          type="button"
          className="primary"
          onClick={() => setShowAddModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <Plus size={16} /> Novo Documento
        </button>
      </div>

      {/* Semantic Search Tester Card */}
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 8,
          padding: 20,
          marginBottom: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Search size={16} style={{ color: 'var(--color-brand)' }} />
          <h2 style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>Testar Busca Semântica (pgvector)</h2>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Ex: Quanto custa o plano familiar? ou Quais são os horários de plantão?"
            style={{ flex: 1, minWidth: 260 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, margin: 0 }}>Limiar:</label>
            <input
              type="number"
              min={0.1}
              max={0.99}
              step={0.05}
              value={searchThreshold}
              onChange={e => setSearchThreshold(parseFloat(e.target.value))}
              style={{ width: 68 }}
            />
          </div>
          <button type="submit" className="secondary" disabled={searching || !searchQuery.trim()}>
            {searching ? 'Buscando...' : 'Buscar Chunks'}
          </button>
        </form>

        {searchResults && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8, textTransform: 'uppercase' }}>
              Resultados Encontrados ({searchResults.length}):
            </h3>
            {searchResults.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                Nenhum trecho atingiu o limiar de similaridade de {(searchThreshold * 100).toFixed(0)}%.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchResults.map(hit => (
                  <div
                    key={hit.id}
                    style={{
                      padding: '10px 14px',
                      background: 'var(--color-bg-secondary)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong>
                        [{hit.collection.toUpperCase()}] {hit.title}
                      </strong>
                      <span className="badge" style={{ color: 'var(--color-brand)' }}>
                        Similaridade: {(hit.similarity * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--color-text-secondary)' }}>{hit.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collection Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
        {[
          { id: 'all', label: 'Todas as Coleções' },
          { id: 'pricing', label: 'Preços & Planos' },
          { id: 'catalog', label: 'Catálogo de Serviços' },
          { id: 'faq', label: 'Perguntas Frequentes' },
          { id: 'objections', label: 'Objeções Comerciais' },
          { id: 'documents', label: 'Geral / Documentos' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            className={selectedCollection === tab.id ? 'primary' : 'secondary'}
            onClick={() => setSelectedCollection(tab.id)}
            style={{ fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Documents List */}
      {error && (
        <div style={{ padding: 12, background: '#fee2e2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>Carregando base...</div>
      ) : documents.length === 0 ? (
        <div
          style={{
            border: '2px dashed var(--color-border-secondary)',
            borderRadius: 8,
            padding: 40,
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Database size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <h3>Nenhum documento cadastrado</h3>
          <p style={{ fontSize: 13, maxWidth: 450, margin: '6px auto 16px' }}>
            Adicione artigos, tabelas de valores e instruções para que o agente consulte respostas factuais e evite
            alucinações.
          </p>
          <button type="button" className="primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} style={{ display: 'inline', marginRight: 4 }} /> Adicionar Documento
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {documents.map(doc => (
            <div
              key={doc.id}
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="badge" style={{ textTransform: 'uppercase', fontSize: 10 }}>
                    {doc.collection}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>~{doc.token_count} tokens</span>
                </div>
                <h3 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 600 }}>{doc.title}</h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                    lineHeight: 1.5,
                    maxHeight: 90,
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
                  marginTop: 14,
                  paddingTop: 10,
                  borderTop: '1px solid var(--color-border-secondary)',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                  title="Excluir"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Document Modal */}
      {showAddModal && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
          <div className="modal-content" style={{ maxWidth: 580 }}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Novo Documento de Conhecimento</h2>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Coleção</label>
                <select
                  value={newCollection}
                  onChange={e => setNewCollection(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="pricing">Preços & Planos (pricing)</option>
                  <option value="catalog">Catálogo de Serviços (catalog)</option>
                  <option value="faq">Perguntas Frequentes (faq)</option>
                  <option value="objections">Objeções de Vendas (objections)</option>
                  <option value="documents">Geral / Políticas (documents)</option>
                </select>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Título do Documento</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Ex: Tabela de Valores - Plano Odonto Familiar 2026"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Conteúdo Textual</label>
                <textarea
                  required
                  rows={8}
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder="Insira o texto com informações claras e números exatos para o agente citar com precisão..."
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="secondary" onClick={() => setShowAddModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? 'Gravando...' : 'Salvar Documento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
