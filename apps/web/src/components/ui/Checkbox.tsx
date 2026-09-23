import React, { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
}

/** Themed checkbox. Keeps a real (visually hidden) input so forms, labels and keyboard keep working. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, indeterminate, className = '', checked, disabled, ...props }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);
    const on = Boolean(checked) || Boolean(indeterminate);
    const box = (
      <span className="relative inline-flex h-4 w-4 flex-shrink-0">
        <input
          ref={node => {
            innerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className="peer absolute inset-0 m-0 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none flex h-4 w-4 items-center justify-center rounded border transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 ${
            on ? 'border-brand bg-brand text-canvas' : 'border-border-strong bg-surface'
          } ${disabled ? 'opacity-50' : ''}`}
        >
          {indeterminate ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      </span>
    );
    if (!label) return <span className={`inline-flex ${className}`}>{box}</span>;
    return (
      <label className={`checkbox-row flex cursor-pointer items-start gap-2.5 ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className}`}>
        <span className="mt-0.5">{box}</span>
        <span className="flex min-w-0 flex-col">
          <span className="text-xs font-medium text-content">{label}</span>
          {description && <span className="text-2xs leading-snug text-content-muted">{description}</span>}
        </span>
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
  size?: 'sm' | 'md';
}

/** On/off toggle for settings that apply immediately (tools, modes). */
export function Switch({ checked, onChange, disabled, size = 'md', ...aria }: SwitchProps) {
  const dims = size === 'sm' ? { track: 'h-4 w-7', thumb: 'h-3 w-3', on: 'translate-x-3' } : { track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'translate-x-4' };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex min-h-0 flex-shrink-0 items-center rounded-full border-0 p-0.5 outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50 ${dims.track} ${
        checked ? 'bg-brand' : 'bg-border-strong'
      }`}
      {...aria}
    >
      <span
        className={`block rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${dims.thumb} ${checked ? dims.on : 'translate-x-0'}`}
      />
    </button>
  );
}
