import React, {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from './usePresence';
import { useAnchoredPosition, type Align, type Side } from './useAnchoredPosition';

// Open floating layers, innermost last. A click inside a layer opened *after* this one (a menu
// inside a popover) must not close this one.
const layerStack: string[] = [];

export interface PopoverProps {
  /** Element that toggles the popover. Receives aria-expanded / aria-haspopup. */
  trigger: ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side;
  align?: Align;
  offset?: number;
  className?: string;
  /** Fixed panel width in px; defaults to the content width. */
  width?: number;
  /** role of the panel (dialog for forms, menu/listbox set by wrappers). */
  role?: string;
  'aria-label'?: string;
  /** Focus the first focusable element inside when opening (default true). */
  autoFocus?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  panelRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Stretch the anchor wrapper to full width (for full-width triggers like selects). */
  block?: boolean;
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  offset,
  className = '',
  width,
  role = 'dialog',
  autoFocus = true,
  onKeyDown,
  panelRef: externalPanelRef,
  block = false,
  ...aria
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  const layerId = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { mounted, closing } = usePresence(open, 120);
  const position = useAnchoredPosition(anchorRef, panelRef, mounted, { side, align, offset });

  useEffect(() => {
    if (!open) return;
    layerStack.push(layerId);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      const myIndex = layerStack.indexOf(layerId);
      const insideNewerLayer = layerStack
        .slice(myIndex + 1)
        .some(id => document.querySelector(`[data-layer="${CSS.escape(id)}"]`)?.contains(target));
      if (insideNewerLayer) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || layerStack[layerStack.length - 1] !== layerId) return;
      event.stopPropagation();
      close();
      const focusable = anchorRef.current?.querySelector<HTMLElement>('button, a, input, [tabindex]');
      focusable?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      const index = layerStack.indexOf(layerId);
      if (index >= 0) layerStack.splice(index, 1);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, layerId, close]);

  useEffect(() => {
    if (!open || !autoFocus || !position) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>(
      '[data-autofocus], input:not([type=hidden]), textarea, select, [role=menuitem], [role=option], button, a[href], [tabindex="0"]'
    );
    first?.focus({ preventScroll: true });
  }, [open, autoFocus, position]);

  const triggerNode = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        'aria-expanded': open,
        'aria-haspopup': role === 'menu' ? 'menu' : role === 'listbox' ? 'listbox' : 'dialog',
        onClick: (event: React.MouseEvent) => {
          (trigger.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(event);
          if (!event.defaultPrevented) setOpen(!open);
        },
      })
    : trigger;

  return (
    <>
      <span ref={anchorRef} className={block ? 'flex w-full' : 'inline-flex'}>
        {triggerNode}
      </span>
      {mounted &&
        createPortal(
          <div
            ref={node => {
              panelRef.current = node;
              if (externalPanelRef) externalPanelRef.current = node;
            }}
            data-layer={layerId}
            role={role}
            aria-label={aria['aria-label']}
            data-closing={closing || undefined}
            onKeyDown={onKeyDown}
            className={`motion-popover fixed z-[80] overflow-auto rounded-xl border border-border bg-surface text-content shadow-modal outline-none ${className}`}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width,
              maxHeight: position ? Math.max(160, position.maxHeight) : undefined,
              transformOrigin: position?.origin,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body
        )}
    </>
  );
}
