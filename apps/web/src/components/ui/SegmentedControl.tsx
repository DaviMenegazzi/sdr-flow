import React, { type ReactNode } from 'react';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** One implementation for every "Todos · IA · Humano" style filter. */
export function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  size = 'md',
  fullWidth = false,
  className = '',
  ...aria
}: SegmentedControlProps<T>) {
  const height = size === 'sm' ? 'h-7' : 'h-8';
  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated p-0.5 ${height} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex h-full min-h-0 items-center justify-center gap-1.5 rounded-md border-0 px-2.5 text-xs font-medium outline-none transition-[color,background-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-brand/40 ${
              fullWidth ? 'flex-1' : ''
            } ${active ? 'bg-surface text-content shadow-xs' : 'bg-transparent text-content-secondary hover:text-content'}`}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
            {option.count !== undefined && (
              <span className={`tabular-nums text-2xs ${active ? 'text-content-secondary' : 'text-content-muted'}`}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
