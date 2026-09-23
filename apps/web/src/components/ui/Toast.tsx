import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds; errors stay longer by default. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

function push(message: string, options: ToastOptions = {}) {
  const item: ToastItem = { id: nextId++, message, variant: 'success', ...options };
  items = [...items.slice(-3), item];
  emit();
  return item.id;
}

export function dismissToast(id: number) {
  items = items.filter(item => item.id !== id);
  emit();
}

/** Call from anywhere — no hook or context needed. */
export const toast = Object.assign((message: string, options?: ToastOptions) => push(message, options), {
  success: (message: string, options?: ToastOptions) => push(message, { ...options, variant: 'success' }),
  error: (message: string, options?: ToastOptions) => push(message, { ...options, variant: 'error' }),
  info: (message: string, options?: ToastOptions) => push(message, { ...options, variant: 'info' }),
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => items;

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration ?? (item.variant === 'error' ? 7000 : item.action ? 6000 : 4000));
  const startedAt = useRef(Date.now());

  useEffect(() => {
    // Pause while hovered or while the tab is hidden, so a toast is never missed.
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => dismissToast(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, item.id]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const Icon = item.variant === 'error' ? AlertCircle : item.variant === 'info' ? Info : CheckCircle2;
  const tone = item.variant === 'error' ? 'text-danger' : item.variant === 'info' ? 'text-info' : 'text-success';

  return (
    <div
      role={item.variant === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className="toast pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-content shadow-modal"
    >
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-xs font-medium leading-snug">{item.message}</p>
        {item.description && <p className="m-0 mt-0.5 text-2xs leading-snug text-content-secondary">{item.description}</p>}
      </div>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
          className="min-h-0 flex-shrink-0 rounded-md border-0 bg-surface-elevated px-2 py-1 text-2xs font-semibold text-content hover:bg-border"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={() => dismissToast(item.id)}
        className="min-h-0 flex-shrink-0 rounded-md border-0 bg-transparent p-0.5 text-content-muted hover:text-content"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Mount once near the app root. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pb-[env(safe-area-inset-bottom,0px)]"
    >
      {list.map(item => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body
  );
}
