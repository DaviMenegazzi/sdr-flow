import { useEffect, useState, useMemo } from 'react';
import { catalog } from '@sdr/flow';
import type { FlowNode } from '@sdr/shared';
import { useBuilder } from './store';
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
  AlertCircle
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
    pricing: '💳 Preços & Planos',
    catalog: '🩺 Catálogo & Serviços',
    faq: '❓ Dúvidas & FAQ',
    objections: '🛡️ Objeções Comerciais',
    documents: '📋 Políticas & Diretrizes',
  },
  targetMode: {
    active_lead: '👤 Lead ativo da conversa (Padrão)',
    specific_targets: '🎯 Apenas Destinatários Específicos',
    both: '👥 Ambos (Lead ativo + Notificar Destinatários)',
  },
};

// Componente para listas de tags/chips com zero código
function ChipListInput({
  values = [],
  onChange,
  placeholder = 'Digitar e pressionar Enter...',
  icon,
  badgeBg = '#464feb12',
  badgeColor = '#464feb',
}: {
  values: string[];
  onChange: (newValues: string[]) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  badgeBg?: string;
  badgeColor?: string;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {values.map(val => (
            <span
              key={val}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 6,
                background: badgeBg,
                color: badgeColor,
                fontSize: 11,
                fontWeight: 600,
                border: '1px solid rgba(0,0,0,0.06)',
                wordBreak: 'break-all',
              }}
            >
              {icon}
              {val}
              <button
                type="button"
                onClick={() => handleRemove(val)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 1,
                  display: 'flex',
                  color: 'inherit',
                  minHeight: 'auto',
                  opacity: 0.7,
                }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={inputValue}
          placeholder={placeholder}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!inputValue.trim()}
          style={{ fontSize: 11, padding: '6px 10px', minHeight: 32 }}
        >
          <Plus size={13} /> Adicionar
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
  const [instances, setInstances] = useState<Array<{ name: string; status: string }>>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<{
    groups: Array<{ id: string; name: string; size?: number }>;
    contacts: Array<{ id: string; name: string; jid: string }>;
  }>({ groups: [], contacts: [] });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/connections/instances')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setInstances(data);
          const connected = data.find(i => i.status === 'connected') || data[0];
          if (connected) setSelectedInstance(connected.name);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedInstance) return;
    setLoading(true);
    fetch(`/api/connections/instances/${encodeURIComponent(selectedInstance)}/targets`)
      .then(res => res.json())
      .then(data => {
        setTargets({
          groups: Array.isArray(data.groups) ? data.groups : [],
          contacts: Array.isArray(data.contacts) ? data.contacts : [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedInstance]);

  const filteredGroups = useMemo(() => {
    if (typeFilter === 'contacts') return [];
    const term = search.toLowerCase();
    return targets.groups.filter(g => g.name.toLowerCase().includes(term) || g.id.toLowerCase().includes(term));
  }, [targets.groups, search, typeFilter]);

  const filteredContacts = useMemo(() => {
    if (typeFilter === 'groups') return [];
    const term = search.toLowerCase();
    return targets.contacts.filter(c => c.name.toLowerCase().includes(term) || c.id.toLowerCase().includes(term));
  }, [targets.contacts, search, typeFilter]);

  return (
    <div style={{ position: 'relative', marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
          padding: '6px 10px',
          background: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {typeFilter === 'groups' ? <Users size={13} color="#d97706" /> : <Radio size={13} color="#16a34a" />}
          {open ? 'Fechar lista da instância' : `Selecionar da instância (${selectedInstance || 'conectada'})`}
        </span>
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            padding: 10,
            marginTop: 4,
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {instances.length > 1 && (
            <select
              value={selectedInstance}
              onChange={e => setSelectedInstance(e.target.value)}
              style={{ fontSize: 11, padding: '4px 6px' }}
            >
              {instances.map(inst => (
                <option key={inst.name} value={inst.name}>
                  {inst.name} ({inst.status})
                </option>
              ))}
            </select>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px' }}>
            <Search size={13} color="var(--color-text-secondary)" />
            <input
              type="text"
              placeholder="Filtrar por nome ou número..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ border: 'none', padding: 0, fontSize: 11, width: '100%' }}
            />
          </div>

          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {loading ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: 10, textAlign: 'center' }}>
                Buscando contatos e grupos...
              </div>
            ) : filteredGroups.length === 0 && filteredContacts.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: 10, textAlign: 'center' }}>
                Nenhum destino encontrado na instância.
              </div>
            ) : (
              <>
                {filteredGroups.length > 0 && (
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', display: 'block', padding: '4px 2px' }}>
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
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          justifyContent: 'flex-start',
                          fontSize: 11,
                          padding: '5px 8px',
                          border: 'none',
                          background: 'transparent',
                          gap: 6,
                          borderRadius: 4,
                        }}
                      >
                        <Users size={12} color="#d97706" />
                        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.name}
                        </span>
                        {typeof g.size === 'number' && (
                          <span style={{ fontSize: 10, opacity: 0.6 }}>{g.size} membros</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {filteredContacts.length > 0 && (
                  <div style={{ marginTop: filteredGroups.length > 0 ? 6 : 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', display: 'block', padding: '4px 2px' }}>
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
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          justifyContent: 'flex-start',
                          fontSize: 11,
                          padding: '5px 8px',
                          border: 'none',
                          background: 'transparent',
                          gap: 6,
                          borderRadius: 4,
                        }}
                      >
                        <Phone size={12} color="#16a34a" />
                        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.6 }}>{c.id}</span>
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

        <div style={{ background: isEnabled ? 'rgba(234, 179, 8, 0.08)' : 'var(--color-bg-secondary)', border: `1px solid ${isEnabled ? '#eab308' : 'var(--color-border)'}`, borderRadius: 8, padding: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontWeight: 700, color: isEnabled ? '#b45309' : 'inherit' }}>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={e => field('enabled', e.target.checked)}
              style={{ width: 'auto', accentColor: '#eab308' }}
            />
            {isEnabled ? 'Portão de Teste / Filtro Ativo' : 'Filtro Desativado (Livre)'}
          </label>
          <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '6px 0 0', lineHeight: 1.4 }}>
            {isEnabled
              ? 'Apenas remetentes presentes nas listas abaixo avançam no fluxo. Qualquer outro contato ou grupo terá a mensagem interrompida aqui (não responderá).'
              : 'Qualquer remetente que enviar mensagem avançará normalmente para os próximos blocos.'}
          </p>
        </div>

        {isEnabled && (
          <>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Phone size={13} color="#16a34a" /> Contatos Autorizados ({allowedPhones.length})
              </label>
              <ChipListInput
                values={allowedPhones}
                onChange={newVals => field('allowedPhones', newVals)}
                placeholder="+55 11 99999-9999"
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
                <Users size={13} color="#d97706" /> Grupos Autorizados ({allowedGroups.length})
              </label>
              <ChipListInput
                values={allowedGroups}
                onChange={newVals => field('allowedGroups', newVals)}
                placeholder="120363...@g.us ou ID do grupo"
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
              style={{ fontSize: 10, padding: '2px 6px', minHeight: 'auto', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              + {tag}
            </button>
          ))}
        </div>

        <label>
          <span className="check-row">
            <input
              type="checkbox"
              checked={node.config.typing !== false}
              onChange={e => field('typing', e.target.checked)}
            />
            Mostrar digitando antes de enviar
          </span>
        </label>

        {/* Modo de Destinatário */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Destinatário da Mensagem
          </label>
          <select
            value={targetMode}
            onChange={e => field('targetMode', e.target.value)}
            style={{ fontSize: 12 }}
          >
            <option value="active_lead">👤 Lead que enviou a mensagem (Padrão)</option>
            <option value="specific_targets">🎯 Apenas Destinatários Específicos (Contatos / Grupos)</option>
            <option value="both">👥 Ambos (Lead ativo + Notificar Destinatários Específicos)</option>
          </select>
        </div>

        {/* Seletor de Destinatários Específicos */}
        {(targetMode === 'specific_targets' || targetMode === 'both') && (
          <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 8, padding: 12, border: '1px solid var(--color-border)' }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Send size={13} color="#464feb" /> Destinos Notificados ({targets.length})
            </label>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
              Selecione contatos ou grupos da sua instância WhatsApp para receber este disparo:
            </p>

            <ChipListInput
              values={targets}
              onChange={newTargets => field('targets', newTargets)}
              placeholder="Número ou JID do grupo..."
              icon={<Send size={11} />}
              badgeBg="#464feb15"
              badgeColor="#464feb"
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

      {Object.entries(properties).map(([key, property]) => (
        <label key={`${node.id}-${key}`}>
          {property.description ?? key}
          {property.enum ? (
            <select
              value={String(node.config[key] ?? '')}
              onChange={event => field(key, event.target.value)}
            >
              {property.enum.map(value => (
                <option key={value} value={value}>
                  {enumLabels[key]?.[value] ?? value}
                </option>
              ))}
            </select>
          ) : property.type === 'boolean' ? (
            <span className="check-row">
              <input
                type="checkbox"
                checked={node.config[key] === true}
                onChange={event => field(key, event.target.checked)}
              />
              Ativado
            </span>
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
              rows={key === 'prompt' || key === 'text' ? 5 : 2}
              value={String(node.config[key] ?? '')}
              onChange={event => field(key, event.target.value)}
            />
          )}
        </label>
      ))}

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
