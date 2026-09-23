import React, { useState } from 'react';
import { Calendar, Check } from 'lucide-react';
import { Popover } from './Popover';
import { formatShortDate } from '../../lib/format';

export interface DateRange {
  /** yyyy-mm-dd, inclusive; empty = open-ended */
  start: string;
  end: string;
  /** Preset key when the range came from a preset. */
  preset?: string;
}

export interface DatePreset {
  key: string;
  label: string;
  days: number | null; // null = no bound ("todo o período")
}

export const DEFAULT_PRESETS: DatePreset[] = [
  { key: 'today', label: 'Hoje', days: 0 },
  { key: '7d', label: 'Últimos 7 dias', days: 6 },
  { key: '30d', label: 'Últimos 30 dias', days: 29 },
  { key: '90d', label: 'Últimos 90 dias', days: 89 },
];

function iso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function rangeFromPreset(preset: DatePreset, now = new Date()): DateRange {
  if (preset.days === null) return { start: '', end: '', preset: preset.key };
  const start = new Date(now);
  start.setDate(start.getDate() - preset.days);
  return { start: iso(start), end: iso(now), preset: preset.key };
}

/** Same-length window right before `range` — used for "vs. período anterior" deltas. */
export function previousRange(range: DateRange): DateRange | null {
  if (!range.start || !range.end) return null;
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { start: iso(prevStart), end: iso(prevEnd) };
}

export function describeRange(range: DateRange, presets: DatePreset[] = DEFAULT_PRESETS): string {
  const preset = presets.find(p => p.key === range.preset);
  if (preset) return preset.label;
  if (range.start && range.end) return `${formatShortDate(`${range.start}T00:00:00`)} – ${formatShortDate(`${range.end}T00:00:00`)}`;
  if (range.start) return `Desde ${formatShortDate(`${range.start}T00:00:00`)}`;
  if (range.end) return `Até ${formatShortDate(`${range.end}T00:00:00`)}`;
  return 'Todo o período';
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  presets?: DatePreset[];
  /** Offer "Todo o período" (no bounds). */
  allowAll?: boolean;
  size?: 'sm' | 'md';
}

/** Presets as rows (nobody fights a calendar for "last 30 days"); custom range behind a hairline. */
export function DateRangePicker({ value, onChange, presets = DEFAULT_PRESETS, allowAll = false, size = 'md' }: DateRangePickerProps) {
  const [customStart, setCustomStart] = useState(value.start);
  const [customEnd, setCustomEnd] = useState(value.end);
  const list = allowAll ? [...presets, { key: 'all', label: 'Todo o período', days: null }] : presets;

  return (
    <Popover
      align="start"
      width={260}
      className="p-1"
      trigger={
        <button
          type="button"
          className={`flex min-h-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs text-content outline-none hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-brand/40 ${
            size === 'sm' ? 'h-7' : 'h-8'
          }`}
        >
          <Calendar size={14} className="text-content-muted" />
          {describeRange(value, list)}
        </button>
      }
    >
      {close => (
        <>
          {list.map(preset => {
            const active = value.preset === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  onChange(rangeFromPreset(preset));
                  close();
                }}
                className={`flex w-full min-h-0 items-center justify-between rounded-lg border-0 px-2.5 py-2 text-left text-xs outline-none hover:bg-surface-elevated focus:bg-surface-elevated ${
                  active ? 'bg-transparent font-semibold text-content' : 'bg-transparent text-content'
                }`}
              >
                {preset.label}
                {active && <Check size={16} strokeWidth={2.5} className="text-brand-fg" />}
              </button>
            );
          })}
          <div className="mt-1 border-t border-border p-2">
            <p className="m-0 mb-2 text-2xs font-medium text-content-muted">Intervalo personalizado</p>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Data inicial"
                value={customStart}
                max={customEnd || undefined}
                onChange={event => setCustomStart(event.target.value)}
                className="date-input h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-1.5 text-xs"
              />
              <span className="text-content-muted">–</span>
              <input
                type="date"
                aria-label="Data final"
                value={customEnd}
                min={customStart || undefined}
                onChange={event => setCustomEnd(event.target.value)}
                className="date-input h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-1.5 text-xs"
              />
            </div>
            <button
              type="button"
              disabled={!customStart && !customEnd}
              onClick={() => {
                onChange({ start: customStart, end: customEnd });
                close();
              }}
              className="mt-2 flex h-8 w-full min-h-0 items-center justify-center rounded-lg border border-border bg-surface-elevated text-xs font-medium text-content hover:bg-border disabled:opacity-40"
            >
              Aplicar intervalo
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}
