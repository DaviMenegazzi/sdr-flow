import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get the danger button and the warning icon. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

/** Replaces window.confirm(): `if (!(await confirmDialog({...}))) return;` */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false);
  return new Promise(resolve => {
    pending = { ...options, resolve };
    emit();
  });
}

function settle(ok: boolean) {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(ok);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => pending;

/** Mount once near the app root. */
export function ConfirmHost() {
  const live = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Keep showing the last dialog's text while its exit animation plays.
  const lastShown = useRef<Pending | null>(null);
  if (live) lastShown.current = live;
  const current = live ?? lastShown.current;

  useEffect(() => {
    // Destructive dialogs focus Cancel; the rest focus the confirm button.
    if (live && !live.danger) confirmRef.current?.focus();
  }, [live]);

  return (
    <Modal
      isOpen={Boolean(live)}
      onClose={() => settle(false)}
      maxWidth="sm"
      title={
        <span className="flex items-center gap-2">
          {current?.danger && <AlertTriangle size={16} className="text-danger" />}
          {current?.title}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => settle(false)} autoFocus={current?.danger}>
            {current?.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button ref={confirmRef} variant={current?.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {current?.confirmLabel ?? 'Confirmar'}
          </Button>
        </>
      }
    >
      {current?.description && <div className="text-sm leading-relaxed text-content-secondary">{current.description}</div>}
    </Modal>
  );
}
