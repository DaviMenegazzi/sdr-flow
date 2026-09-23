import React, { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { usePresence } from './usePresence';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
}: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const { mounted, closing } = usePresence(isOpen);
  if (!mounted) return null;

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm motion-overlay"
      data-closing={closing || undefined}
      onClick={onClose}
    >
      <div
        className={`w-full ${widths[maxWidth]} bg-surface border border-border rounded-2xl shadow-modal flex flex-col max-h-[90vh] overflow-hidden motion-modal`}
        data-closing={closing || undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-content-primary">{title}</h2>
              {description && (
                <div className="text-xs text-content-secondary mt-0.5">{description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex h-8 w-8 min-h-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="p-4 bg-surface-subtle border-t border-border flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
