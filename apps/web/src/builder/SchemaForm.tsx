import { useEffect, useState } from 'react';
import { catalog } from '@sdr/flow';
import type { FlowNode } from '@sdr/shared';
import { useBuilder } from './store';

interface Property { type?: string; description?: string; enum?: string[]; minimum?: number; maximum?: number }
const enumLabels: Record<string, Record<string, string>> = {
  collection: {
    default: 'Todas as coleções',
    pricing: '💳 Preços & Planos',
    catalog: '🩺 Catálogo & Serviços',
    faq: '❓ Dúvidas & FAQ',
    objections: '🛡️ Objeções Comerciais',
    documents: '📋 Políticas & Diretrizes',
  },
};
function JsonField({ value, onChange }: { value: unknown; onChange(value: never): void }) {
  const [draft,setDraft] = useState(JSON.stringify(value,null,2));
  const [error,setError] = useState('');
  useEffect(() => { setDraft(JSON.stringify(value,null,2)); setError(''); },[value]);
  return <><textarea value={draft} rows={4} onChange={event => { const text = event.target.value; setDraft(text); try { const result = JSON.parse(text) as never; onChange(result); setError(''); } catch { setError('JSON incompleto ou inválido.'); } }} />{error && <small className="field-error">{error}</small>}</>;
}
export function SchemaForm({ node }: { node: FlowNode }) {
  const update = useBuilder(state => state.update);
  const definition = catalog[node.type];
  const properties = (definition.jsonSchema.properties ?? {}) as Record<string,Property>;
  const result = definition.schema.safeParse(node.config);
  const field = (key: string,value: FlowNode['config'][string]) => update(node.id,{ config: { ...node.config,[key]:value } });
  return <div className="schema-form">
    <label>Nome do nó<input value={node.label} maxLength={120} onChange={event => update(node.id,{ label: event.target.value })}/></label>
    {Object.entries(properties).map(([key,property]) => <label key={`${node.id}-${key}`}>
      {property.description ?? key}
      {property.enum ? <select value={String(node.config[key] ?? '')} onChange={event => field(key,event.target.value)}>{property.enum.map(value => <option key={value} value={value}>{enumLabels[key]?.[value] ?? value}</option>)}</select>
        : property.type === 'boolean' ? <span className="check-row"><input type="checkbox" checked={node.config[key] === true} onChange={event => field(key,event.target.checked)}/>Ativado</span>
        : property.type === 'integer' || property.type === 'number' ? <input type="number" min={property.minimum} max={property.maximum} value={typeof node.config[key] === 'number' ? node.config[key] as number : ''} onChange={event => field(key,event.target.value === '' ? null : Number(event.target.value))}/>
        : property.type === 'array' || property.type === 'object' ? <JsonField value={node.config[key]} onChange={value => field(key,value)}/>
        : <textarea rows={key === 'prompt' || key === 'text' ? 5 : 2} value={String(node.config[key] ?? '')} onChange={event => field(key,event.target.value)}/>
      }
    </label>)}
    {Object.keys(properties).length === 0 && <p className="muted">Este nó usa o contexto da conversa e não precisa de configuração adicional.</p>}
    {!result.success && <ul className="field-error">{result.error.issues.map((issue,index) => <li key={index}>{issue.path.join('.')}: {issue.message}</li>)}</ul>}
  </div>;
}
