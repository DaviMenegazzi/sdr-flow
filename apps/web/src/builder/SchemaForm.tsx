import { useEffect, useState, useMemo } from 'react';
import { catalog } from '@sdr/flow';
import type { FlowNode } from '@sdr/shared';
import { useBuilder } from './store';
import { useInstance } from '../context/InstanceContext';
import { useSession } from '../session';
import { Select, Skeleton, SkeletonText, Switch } from '../components/ui';
import {
  Users,
  Phone,
  ShieldAlert,
  Check,
  Plus,
  X,
  Search,
  ChevronDown,
  Sparkles,
  Radio,
  Send,
  MessageSquare,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

interface Property {
  type?: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

const enumLabels: Record<string, Record<string, string>> = {
  collection: {
    default: 'Todas as coleções',
    pricing: 'Preços & Planos',
    catalog: 'Catálogo & Serviços',
    faq: 'Dúvidas & FAQ',
    objections: 'Objeções Comerciais',
    documents: 'Políticas & Diretrizes',
  },
  targetMode: {
    active_lead: 'Lead ativo da conversa (Padrão)',
    specific_targets: 'Apenas Destinatários Específicos',
    both: 'Ambos (Lead ativo + Notificar Destinatários)',
  },
};

// Componente para listas de tags/chips com zero código
function ChipListInput({
  values = [],
  onChange,
  placeholder = 'Digitar e pressionar Enter...',
  icon,
  badgeBg = 'rgba(46, 232, 107, 0.12)',
  badgeColor = '#2ee86b',
  inputName = 'chip-filter-input',
}: {
  values: string[];
  onChange: (newValues: string[]) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  badgeBg?: string;
  badgeColor?: string;
  inputName?: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (!values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue('');
  };

  const handleRemove = (itemToRemove: string) => {
    onChange(values.filter(item => item !== itemToRemove));
  };

  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map(val => (
            <span
              key={val}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-2xs font-semibold border break-all"
              style={{
                background: badgeBg,
                color: badgeColor,
                borderColor: `${badgeColor}33`,
              }}
            >
              {icon}
              <span>{val}</span>
              <button
                type="button"
                onClick={() => handleRemove(val)}
                className="hover:opacity-100 opacity-60 ml-0.5 p-0.5 cursor-pointer text-inherit"
                title="Remover"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          type="text"
          name={inputName}
          id={inputName}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-form-type="other"
          data-lpignore="true"
          value={inputValue}
          placeholder={placeholder}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          className="flex-1 py-1.5 px-2.5 rounded-lg bg-surface-elevated border border-border text-xs text-white placeholder:text-content-muted outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!inputValue.trim()}
          className="px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-[#222] border border-border text-xs font-semibold text-content-primary disabled:opacity-40 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <Plus size={12} />
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}

// Seletor dinâmico de contatos e grupos da Evolution API
function InstanceTargetPicker({
  typeFilter = 'all',
  onSelect,
}: {
  typeFilter?: 'all' | 'contacts' | 'groups';
  onSelect: (id: string, name: string) => void;
}) {
  const { currentInstance } = useInstance();
  const { session, activeOrg } = useSession();
  const selectedInstance = currentInstance?.name || '';
  const connectionId = currentInstance?.id || '';
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<{
    groups: Array<{ id: string; name: string; size?: number }>;
    contacts: Array<{ id: string; name: string; jid: string }>;
  }>({ groups: [], contacts: [] });
  const [open, setOpen] = useState(false);

  const loadTargets = (refresh = false) => {
    if (!activeOrg || !session?.access_token || !connectionId) {
      setTargets({ groups: [], contacts: [] });
      return;
    }
    setLoading(true);
    const url = `/api/organizations/${encodeURIComponent(activeOrg)}/connections/${encodeURIComponent(connectionId)}/targets${refresh ? '?refresh=true' : ''}`;
    fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(res => res.json())
      .then(data => {
        setTargets({
          groups: Array.isArray(data.groups) ? data.groups : [],
          contacts: Array.isArray(data.contacts) ? data.contacts : [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTargets(false);
  }, [activeOrg, connectionId, session?.access_token]);

  const filteredGroups = useMemo(() => {
    if (typeFilter === 'contacts') return [];
    const term = (search || '').toLowerCase().trim();
    return targets.groups.filter(g => {
      const name = (g.name || g.id || '').toLowerCase();
      const id = (g.id || '').toLowerCase();
      return name.includes(term) || id.includes(term);
    });
  }, [targets.groups, search, typeFilter]);

  const filteredContacts = useMemo(() => {
    if (typeFilter === 'groups') return [];
    const term = (search || '').toLowerCase().trim();
    return targets.contacts.filter(c => {
      const name = (c.name || c.id || '').toLowerCase();
      const id = (c.id || '').toLowerCase();
      return name.includes(term) || id.includes(term);
    });
  }, [targets.contacts, search, typeFilter]);

  return (
    <div className="relative mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center text-xs p-2 rounded-lg bg-surface-elevated border border-border text-content-secondary hover:text-content-primary hover:border-brand/40 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          {typeFilter === 'groups' ? <Users size={13} className="text-warning" /> : <Radio size={13} className="text-brand-fg" />}
          <span>{open ? 'Fechar lista da instância' : `Selecionar da instância (${selectedInstance || 'conectada'})`}</span>
        </span>
        <ChevronDown size={13} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-[#161616] border border-[#2a2a2a] rounded-xl shadow-2xl p-2.5 mt-1 max-h-72 flex flex-col gap-2">
          <div className="flex gap-1.5 items-center">
            <div className="flex flex-1 items-center gap-1.5 border border-border rounded-lg px-2 py-1 bg-surface-elevated">
              <Search size={13} className="text-content-muted" />
              <input
                type="text"
                name="search-instance-targets"
                id="search-instance-targets"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                placeholder="Buscar contato ou grupo..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border-none p-0 text-xs w-full outline-none bg-transparent text-white placeholder:text-content-muted"
              />
            </div>
            <button
              type="button"
              title="Atualizar lista de grupos e contatos"
              onClick={() => loadTargets(true)}
              disabled={loading}
              className="p-1.5 rounded-lg text-xs bg-surface-elevated border border-border hover:bg-[#222] text-content-secondary hover:text-white transition-colors cursor-pointer flex items-center gap-1"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 flex flex-col gap-1 pr-1">
            {loading ? (
              <div role="status" aria-live="polite" className="space-y-1.5 p-1">
                <span className="sr-only">Buscando contatos e grupos…</span>
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="flex items-center gap-2 rounded-lg p-1.5" aria-hidden="true">
                    <Skeleton className="h-3 w-3 shrink-0" rounded="full" />
                    <SkeletonText lines={2} className="flex-1" />
                  </div>
                ))}
              </div>
            ) : filteredGroups.length === 0 && filteredContacts.length === 0 ? (
              <div className="text-xs text-content-muted p-2.5 text-center">
                Nenhum destino encontrado na instância.
              </div>
            ) : (
              <>
                {filteredGroups.length > 0 && (
                  <div>
                    <span className="text-2xs font-bold uppercase tracking-wider text-content-muted block px-1 py-1">
                      Grupos ({filteredGroups.length})
                    </span>
                    {filteredGroups.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => {
                          onSelect(g.id, g.name);
                          setOpen(false);
                        }}
                        className="w-full text-left flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-content-primary"
                      >
                        <Users size={12} className="text-warning flex-shrink-0" />
                        <span className="font-medium flex-1 truncate">
                          {g.name}
                        </span>
                        {typeof g.size === 'number' && (
                          <span className="text-2xs text-content-muted">{g.size} membros</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {filteredContacts.length > 0 && (
                  <div className={filteredGroups.length > 0 ? 'mt-1.5' : ''}>
                    <span className="text-2xs font-bold uppercase tracking-wider text-content-muted block px-1 py-1">
                      Contatos ({filteredContacts.length})
                    </span>
                    {filteredContacts.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          onSelect(c.id, c.name);
                          setOpen(false);
                        }}
                        className="w-full text-left flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-content-primary"
                      >
                        <Phone size={12} className="text-brand-fg flex-shrink-0" />
                        <span className="font-medium flex-1 truncate">
                          {c.name}
                        </span>
                        <span className="text-2xs font-mono text-content-muted">{c.id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Fallback JSON editor para schemas complexos
function JsonField({ value, onChange }: { value: unknown; onChange(value: never): void }) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(JSON.stringify(value, null, 2));
    setError('');
  }, [value]);
  return (
    <>
      <textarea
        value={draft}
        rows={4}
        onChange={event => {
          const text = event.target.value;
          setDraft(text);
          try {
            const result = JSON.parse(text) as never;
            onChange(result);
            setError('');
          } catch {
            setError('JSON incompleto ou inválido.');
          }
        }}
      />
      {error && <small className="field-error">{error}</small>}
    </>
  );
}

export function SchemaForm({ node }: { node: FlowNode }) {
  const update = useBuilder(state => state.update);
  const definition = catalog[node.type];
  const properties = (definition?.jsonSchema?.properties ?? {}) as Record<string, Property>;
  const parseResult = definition ? definition.schema.safeParse(node.config) : null;

  const field = (key: string, value: FlowNode['config'][string]) =>
    update(node.id, { config: { ...node.config, [key]: value } });

  // Custom UI para guard.test_mode (Portão de Permissão / Filtro de Conexão)
  if (node.type === 'guard.test_mode') {
    const isEnabled = node.config.enabled !== false;
    const allowedPhones: string[] = Array.isArray(node.config.allowedPhones)
      ? (node.config.allowedPhones as any[]).filter((x): x is string => typeof x === 'string')
      : [];
    const allowedGroups: string[] = Array.isArray(node.config.allowedGroups)
      ? (node.config.allowedGroups as any[]).filter((x): x is string => typeof x === 'string')
      : [];

    return (
      <div className="schema-form">
        <label>
          Nome do nó
          <input
            value={node.label}
            maxLength={120}
            onChange={event => update(node.id, { label: event.target.value })}
          />
        </label>

        <div className={`p-3 rounded-xl border ${isEnabled ? 'bg-warning/10 border-warning/30' : 'bg-surface-elevated border-border'}`}>
          <div className={`flex items-center justify-between gap-2 text-xs font-semibold ${isEnabled ? 'text-warning' : 'text-content-secondary'}`}>
            <span>{isEnabled ? 'Filtro de teste ativo' : 'Filtro desativado'}</span>
            <Switch aria-label="Filtro de teste" checked={isEnabled} onChange={checked => field('enabled', checked)} />
          </div>
          <p className="text-2xs text-content-muted mt-1.5 leading-relaxed">
            {isEnabled
              ? 'Apenas remetentes presentes nas listas abaixo avançam no fluxo. Qualquer outro contato ou grupo terá a mensagem interrompida aqui.'
              : 'Qualquer remetente que enviar mensagem avançará normalmente para os próximos blocos.'}
          </p>
        </div>

        {isEnabled && (
          <>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Phone size={13} className="text-success" /> Contatos Autorizados ({allowedPhones.length})
              </label>
              <ChipListInput
                values={allowedPhones}
                onChange={newVals => field('allowedPhones', newVals)}
                placeholder="Ex: 5511999998888 ou DDD + celular"
                inputName="allowed-phones-filter"
                icon={<Phone size={11} />}
                badgeBg="#16a34a15"
                badgeColor="#16a34a"
              />
              <InstanceTargetPicker
                typeFilter="contacts"
                onSelect={(id, _name) => {
                  if (!allowedPhones.includes(id)) {
                    field('allowedPhones', [...allowedPhones, id]);
                  }
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Users size={13} className="text-warning" /> Grupos Autorizados ({allowedGroups.length})
              </label>
              <ChipListInput
                values={allowedGroups}
                onChange={newVals => field('allowedGroups', newVals)}
                placeholder="Ex: 120363...@g.us ou ID do grupo"
                inputName="allowed-groups-filter"
                icon={<Users size={11} />}
                badgeBg="#d9770615"
                badgeColor="#d97706"
              />
              <InstanceTargetPicker
                typeFilter="groups"
                onSelect={(id, _name) => {
                  if (!allowedGroups.includes(id)) {
                    field('allowedGroups', [...allowedGroups, id]);
                  }
                }}
              />
            </div>
          </>
        )}

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ShieldAlert size={13} /> Portas de Saída:
          </span>
          <ul style={{ paddingLeft: 16, margin: '4px 0 0' }}>
            <li><strong>pass:</strong> Contato ou grupo permitido (avança)</li>
            <li><strong>blocked:</strong> Não autorizado (encerra silenciosamente se desconectado)</li>
          </ul>
        </div>
      </div>
    );
  }

  // Custom UI para output.send_text (Disparo Multi-Destinatário / Finalização)
  if (node.type === 'output.send_text') {
    const targetMode = (node.config.targetMode as string) || 'active_lead';
    const targets: string[] = Array.isArray(node.config.targets)
      ? (node.config.targets as any[]).filter((x): x is string => typeof x === 'string')
      : [];
    const textVal = String(node.config.text || '');

    return (
      <div className="schema-form">
        <label>
          Nome do nó
          <input
            value={node.label}
            maxLength={120}
            onChange={event => update(node.id, { label: event.target.value })}
          />
        </label>

        <label>
          Mensagem de Envio
          <textarea
            rows={5}
            value={textVal}
            onChange={e => field('text', e.target.value)}
            placeholder="Digite o texto da mensagem. Aceita variáveis como {{decision.reply}}"
          />
        </label>

        {/* Variáveis rápidas */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: -12 }}>
          {['{{decision.reply}}', '{{lead.name}}', '{{lead.phone}}', '{{normalizedPhone}}'].map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => field('text', textVal ? `${textVal} ${tag}` : tag)}
              style={{ fontSize: 11, padding: '2px 6px', minHeight: 'auto', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              + {tag}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-content-secondary">
          <span>Mostrar "digitando…" antes de enviar</span>
          <Switch aria-label="Mostrar digitando antes de enviar" checked={node.config.typing !== false} onChange={checked => field('typing', checked)} />
        </div>

        {/* Modo de Destinatário */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Destinatário da Mensagem
          </label>
          <Select
            aria-label="Destinatário da mensagem"
            value={targetMode}
            onChange={value => field('targetMode', value)}
            options={[
              { value: 'active_lead', label: 'Quem enviou a mensagem', description: 'Padrão: responde ao lead da conversa' },
              { value: 'specific_targets', label: 'Destinatários específicos', description: 'Só os contatos e grupos escolhidos abaixo' },
              { value: 'both', label: 'Os dois', description: 'Responde ao lead e avisa os destinatários escolhidos' },
            ]}
          />
        </div>

        {(targetMode === 'specific_targets' || targetMode === 'both') && (
          <div className="p-3 rounded-xl bg-surface-elevated border border-border space-y-2">
            <label className="text-xs font-semibold flex items-center gap-1.5 text-content-primary">
              <Send size={13} className="text-brand-fg" /> Destinos Notificados ({targets.length})
            </label>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
              Selecione contatos ou grupos da sua instância WhatsApp para receber este disparo:
            </p>

            <ChipListInput
              values={targets}
              onChange={newTargets => field('targets', newTargets)}
              placeholder="Ex: 5511999998888 ou 120363...@g.us"
              inputName="send-targets-filter"
              icon={<Send size={11} />}
              badgeBg="rgba(46, 232, 107, 0.12)"
              badgeColor="#2ee86b"
            />

            <InstanceTargetPicker
              typeFilter="all"
              onSelect={(id, _name) => {
                if (!targets.includes(id)) {
                  field('targets', [...targets, id]);
                }
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // Renderizador genérico inteligente com suporte a ChipList para arrays de strings
  return (
    <div className="schema-form">
      <label>
        Nome do nó
        <input
          value={node.label}
          maxLength={120}
          onChange={event => update(node.id, { label: event.target.value })}
        />
      </label>

      {Object.entries(properties).map(([key, property]) =>
        property.type === 'boolean' ? (
          <div key={`${node.id}-${key}`} className="flex items-center justify-between gap-3 text-xs font-medium text-content-secondary">
            <span>{property.description ?? key}</span>
            <Switch aria-label={property.description ?? key} checked={node.config[key] === true} onChange={checked => field(key, checked)} />
          </div>
        ) : (
        <label key={`${node.id}-${key}`}>
          {property.description ?? key}
          {property.enum ? (
            <Select
              aria-label={property.description ?? key}
              value={String(node.config[key] ?? '')}
              onChange={value => field(key, value)}
              options={property.enum.map(value => ({ value, label: enumLabels[key]?.[value] ?? value }))}
            />
          ) : property.type === 'integer' || property.type === 'number' ? (
            <input
              type="number"
              min={property.minimum}
              max={property.maximum}
              value={typeof node.config[key] === 'number' ? (node.config[key] as number) : ''}
              onChange={event => field(key, event.target.value === '' ? null : Number(event.target.value))}
            />
          ) : property.type === 'array' ? (
            Array.isArray(node.config[key]) && (node.config[key] as any[]).every(x => typeof x === 'string') ? (
              <ChipListInput
                values={((node.config[key] as any[]) || []).filter((x): x is string => typeof x === 'string')}
                onChange={newVals => field(key, newVals)}
                placeholder="Digitar item e pressionar Enter..."
              />
            ) : (
              <JsonField value={node.config[key]} onChange={value => field(key, value)} />
            )
          ) : property.type === 'object' ? (
            <JsonField value={node.config[key]} onChange={value => field(key, value)} />
          ) : (
            <textarea
              rows={key === 'prompt' || key === 'text' || key === 'content' ? 5 : 2}
              value={String(node.config[key] ?? '')}
              onChange={event => field(key, event.target.value)}
            />
          )}
        </label>
        )
      )}

      {Object.keys(properties).length === 0 && (
        <p className="muted">Este nó usa o contexto da conversa e não precisa de configuração adicional.</p>
      )}

      {parseResult && !parseResult.success && (
        <ul className="field-error">
          {parseResult.error.issues.map((issue, index) => (
            <li key={index}>
              {issue.path.join('.')}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
