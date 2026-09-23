import React, { type ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Compact empty state: say what is missing and what to do next. */
export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-2 py-8 px-4 ${className}`}>
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 text-brand-fg flex items-center justify-center mb-1">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-content m-0">{title}</p>
      {description && <p className="text-xs text-content-secondary max-w-sm m-0 leading-relaxed">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
