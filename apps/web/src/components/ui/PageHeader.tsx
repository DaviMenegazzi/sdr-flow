import React, { type ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  /** One line of useful context (period, instance, counts) — not a restatement of the title. */
  description?: ReactNode;
  actions?: ReactNode;
  /** Filter row rendered under the title. */
  toolbar?: ReactNode;
  back?: ReactNode;
}

/** The same header on every page: title, context line, actions on the right, filters below. */
export function PageHeader({ title, description, actions, toolbar, back }: PageHeaderProps) {
  return (
    <header className="page-header mb-6 flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {back && <div className="mb-2">{back}</div>}
          <h1 className="m-0 text-2xl font-bold tracking-tight text-content">{title}</h1>
          {description && <p className="m-0 mt-1 max-w-2xl text-sm text-content-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
    </header>
  );
}

/** Standard page container: same max width and padding everywhere. */
export function PageContainer({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className={`mx-auto w-full px-4 py-6 md:px-8 md:py-8 ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>{children}</div>
    </div>
  );
}
