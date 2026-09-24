import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Trash2 } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  onDelete?: () => void;
  deleteTitle?: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
  footer?: React.ReactNode | ((helpers: { close: () => void }) => React.ReactNode);
  icon?: React.ReactNode;
  id?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder = 'Selecione...',
  disabled = false,
  className = '',
  menuClassName = '',
  align = 'left',
  footer,
  icon,
  id,
  ariaLabel,
  size = 'md',
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const isFullWidth = className.includes('w-full');

  return (
    <div className={`relative ${isOpen ? 'z-40' : 'z-10'} ${isFullWidth ? 'w-full block' : 'inline-block'} text-left`} ref={containerRef}>
      <button
        type="button"
        id={id}
        disabled={disabled || options.length === 0}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || label || placeholder}
        className={`flex items-center justify-between gap-2 bg-surface-elevated border border-border text-content-primary transition-all hover:border-border-strong cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${
          size === 'sm' ? 'px-2.5 py-1 text-xs rounded-lg' : 'px-3 py-1.5 text-xs rounded-xl'
        } ${isOpen ? 'border-border-strong ring-1 ring-white/10' : ''} ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon && <span className="flex-shrink-0 text-content-muted">{icon}</span>}
          {label && (
            <span className="text-content-muted font-medium text-[11px] select-none flex-shrink-0">
              {label}
            </span>
          )}
          <span className="font-semibold text-content-primary truncate text-left">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown
          size={13}
          className={`text-content-muted flex-shrink-0 transition-transform duration-200 ml-1 ${
            isOpen ? 'rotate-180 text-content-primary' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={ariaLabel || label || placeholder}
          className={`absolute top-[calc(100%+6px)] z-50 min-w-full ${
            isFullWidth ? 'w-full' : 'min-w-[220px]'
          } max-h-72 overflow-y-auto p-1.5 bg-surface-elevated border border-border-strong rounded-xl shadow-2xl backdrop-blur-md ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
        >
          <div className="flex flex-col gap-1">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  role="option"
                  tabIndex={opt.disabled ? -1 : 0}
                  aria-selected={isSelected}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (opt.disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onChange(opt.value);
                      setIsOpen(false);
                    }
                  }}
                  className={`group w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer select-none border ${
                    opt.disabled ? 'opacity-40 cursor-not-allowed' : ''
                  } ${
                    isSelected
                      ? 'bg-brand/10 border-brand/30 text-content-primary'
                      : 'border-transparent hover:bg-white/5 text-content-secondary hover:text-content-primary'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {opt.icon && <span className="flex-shrink-0 text-content-muted">{opt.icon}</span>}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className={`text-xs truncate ${
                          isSelected ? 'font-bold text-content-primary' : 'font-semibold text-content-primary'
                        }`}
                      >
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="text-[11px] text-content-muted truncate mt-0.5">
                          {opt.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {opt.badge && (
                      <div className="flex-shrink-0">
                        {opt.badge}
                      </div>
                    )}
                    {isSelected && (
                      <Check size={14} className="text-brand flex-shrink-0 stroke-[2.5]" />
                    )}
                    {opt.onDelete && (
                      <button
                        type="button"
                        title={opt.deleteTitle || 'Excluir'}
                        aria-label={opt.deleteTitle || 'Excluir'}
                        onClick={(e) => {
                          e.stopPropagation();
                          opt.onDelete?.();
                        }}
                        className="p-1.5 rounded-lg text-content-muted hover:text-red-400 hover:bg-red-500/15 opacity-70 group-hover:opacity-100 transition-all ml-1 cursor-pointer flex-shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {footer && (
            <div className="pt-1.5 mt-1 border-t border-border">
              {typeof footer === 'function' ? footer({ close: () => setIsOpen(false) }) : footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
