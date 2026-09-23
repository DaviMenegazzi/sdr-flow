import React, { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { usePresence } from './usePresence';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl' | '2xl';
}

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'xl',
}: DrawerProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const { mounted, closing } = usePresence(isOpen);
  if (!mounted) return null;

  const widthClasses = {
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm motion-overlay"
        data-closing={closing || undefined}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <aside
        className={`relative z-50 w-full ${widthClasses[width]} bg-surface border-l border-border shadow-modal flex flex-col h-full motion-drawer`}
        data-closing={closing || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border bg-surface flex-shrink-0">
          <div>
            {title && (
              <h2 className="text-base font-semibold text-content tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-xs text-content-secondary mt-1 max-w-md">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel"
            className="p-1.5 rounded-lg text-content-muted hover:text-content hover:bg-surface-elevated transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="p-4 bg-surface-subtle border-t border-border flex items-center justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
}
