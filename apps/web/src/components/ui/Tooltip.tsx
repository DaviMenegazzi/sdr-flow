import React, { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPosition, type Side } from './useAnchoredPosition';

// Once one tooltip has been shown, neighbours open instantly (no delay, no animation) — the
// toolbar feels faster without defeating the initial delay.
let lastHiddenAt = 0;
const WARM_WINDOW_MS = 500;
const DELAY_MS = 400;

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  /** Keyboard shortcut shown next to the label. */
  shortcut?: string;
}

export function Tooltip({ content, children, side = 'top', shortcut }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const timer = useRef<number>();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const position = useAnchoredPosition(anchorRef, panelRef, open, { side, align: 'center', offset: 6 });

  const show = () => {
    window.clearTimeout(timer.current);
    const warm = Date.now() - lastHiddenAt < WARM_WINDOW_MS;
    setInstant(warm);
    if (warm) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(prev => {
      if (prev) lastHiddenAt = Date.now();
      return false;
    });
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!content) return children;

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        onPointerEnter={event => event.pointerType === 'mouse' && show()}
        onPointerLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
        onPointerDown={hide}
      >
        {cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-describedby': open ? id : undefined })}
      </span>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="tooltip"
            className={`tooltip pointer-events-none fixed z-[90] flex items-center gap-2 rounded-md bg-content px-2 py-1 text-2xs font-medium text-canvas shadow-elevated ${
              instant ? '' : 'tooltip-animate'
            }`}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              transformOrigin: position?.origin,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {content}
            {shortcut && <kbd className="rounded bg-canvas/20 px-1 font-sans">{shortcut}</kbd>}
          </div>,
          document.body
        )}
    </>
  );
}
