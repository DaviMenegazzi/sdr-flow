import React from 'react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  className?: string;
  variant?: 'line' | 'pills';
}

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  className = '',
  variant = 'line',
}: TabsProps<T>) {
  if (variant === 'pills') {
    return (
      <div className={`inline-flex p-1 bg-surface-elevated border border-border rounded-lg gap-1 ${className}`}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border-0 min-h-0 transition-colors duration-150 ease-out ${
                isActive
                  ? 'bg-surface text-content-primary shadow-sm'
                  : 'bg-transparent text-content-secondary hover:text-content-primary'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`text-2xs px-1.5 py-0.2 rounded-full font-bold ${
                    isActive ? 'bg-brand/10 text-brand-fg' : 'bg-surface-elevated text-content-muted'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`flex border-b border-border gap-6 ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 py-3 px-1 text-xs font-medium border-0 border-b-2 rounded-none bg-transparent min-h-0 transition-colors duration-150 ease-out -mb-[1px] ${
              isActive
                ? 'border-brand text-brand-fg font-semibold'
                : 'border-transparent text-content-secondary hover:text-content-primary hover:border-border'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={`text-2xs px-1.5 py-0.5 rounded-full font-bold ${
                  isActive ? 'bg-brand/10 text-brand-fg' : 'bg-surface-elevated text-content-muted'
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
