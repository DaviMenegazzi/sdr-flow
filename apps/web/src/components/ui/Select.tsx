import React, { useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';
import type { Align } from './useAnchoredPosition';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Plain text used for typeahead / search when `label` is not a string. */
  text?: string;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T | null | undefined;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Prefix shown before the value, e.g. "Status:". */
  prefix?: ReactNode;
  disabled?: boolean;
  align?: Align;
  /** Show a search box (defaults to on for long lists). */
  searchable?: boolean;
  menuWidth?: number;
  'aria-label'?: string;
  id?: string;
  /** Visual style: filled field (forms) or ghost chip (toolbars, inline). */
  appearance?: 'field' | 'chip';
  fullWidth?: boolean;
}

/** Replacement for the native <select>: same height as inputs, themed list, keyboard + typeahead. */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Selecionar',
  size = 'md',
  className = '',
  prefix,
  disabled,
  align = 'start',
  searchable,
  menuWidth,
  appearance = 'field',
  fullWidth = appearance === 'field',
  id,
  ...aria
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);
  const showSearch = searchable ?? options.length > 8;
  const textOf = (option: SelectOption<T>) =>
    option.text ?? (typeof option.label === 'string' ? option.label : String(option.value));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(option => textOf(option).toLowerCase().includes(q)) : options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query]);

  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role=option]:not([aria-disabled=true])') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[Math.min(items.length - 1, index + 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (index <= 0 && showSearch) panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
      else items[Math.max(0, index - 1)]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (!showSearch && event.key.length === 1 && /\S/.test(event.key)) {
      const match = items.find(item => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      match?.focus();
    }
  };

  const heights = { sm: 'h-7 text-xs', md: 'h-8 text-xs' };
  const looks = {
    field: 'border border-border bg-surface-elevated hover:border-border-strong px-2.5',
    chip: 'border border-border bg-surface hover:bg-surface-elevated px-2.5',
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      role="listbox"
      align={align}
      block={fullWidth}
      width={menuWidth ?? (fullWidth ? triggerRef.current?.offsetWidth : undefined)}
      panelRef={panelRef}
      onKeyDown={onKeyDown}
      className="min-w-[180px] p-1"
      trigger={
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-label={aria['aria-label']}
          className={`select-trigger flex min-h-0 items-center gap-1.5 rounded-lg text-left text-content outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50 ${heights[size]} ${looks[appearance]} ${fullWidth ? 'w-full' : ''} ${className}`}
        >
          {prefix && <span className="flex-shrink-0 text-content-muted">{prefix}</span>}
          {selected?.icon && <span className="flex-shrink-0">{selected.icon}</span>}
          <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-content-muted'}`}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown size={14} className="flex-shrink-0 text-content-muted" />
        </button>
      }
    >
      {showSearch && (
        <div className="p-1 pb-1.5">
          <input
            data-autofocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar…"
            className="h-8 w-full rounded-md border border-border bg-surface-elevated px-2 text-xs outline-none focus:border-brand"
          />
        </div>
      )}
      {filtered.length === 0 && <div className="px-2.5 py-2 text-xs text-content-muted">Nada encontrado</div>}
      {filtered.map(option => {
        const isSelected = option.value === value;
        return (
          <div
            key={option.value}
            role="option"
            tabIndex={-1}
            aria-selected={isSelected}
            aria-disabled={option.disabled || undefined}
            data-autofocus={!showSearch && isSelected ? true : undefined}
            onClick={() => choose(option)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                choose(option);
              }
            }}
            className={`flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-xs outline-none ${
              option.disabled
                ? 'cursor-not-allowed text-content-muted'
                : 'text-content hover:bg-surface-elevated focus:bg-surface-elevated'
            }`}
          >
            {option.icon && <span className="mt-px flex-shrink-0">{option.icon}</span>}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={isSelected ? 'font-semibold' : ''}>{option.label}</span>
              {option.description && <span className="mt-0.5 text-2xs leading-snug text-content-muted">{option.description}</span>}
            </span>
            <Check size={14} className={`mt-px flex-shrink-0 text-brand-fg ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
          </div>
        );
      })}
    </Popover>
  );
}
