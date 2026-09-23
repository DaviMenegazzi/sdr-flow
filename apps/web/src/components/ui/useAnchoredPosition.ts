import { useLayoutEffect, useState, type RefObject } from 'react';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

export interface AnchoredPosition {
  top: number;
  left: number;
  side: Side;
  /** CSS transform-origin pointing back at the trigger, so the panel grows out of it. */
  origin: string;
  maxHeight: number;
}

const GUTTER = 8;

/**
 * Positions a floating panel (fixed) next to its anchor, flipping to the opposite side when it
 * would overflow the viewport. Recomputes on scroll/resize while open.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  { side = 'bottom', align = 'start', offset = 6 }: { side?: Side; align?: Align; offset?: number } = {}
): AnchoredPosition | null {
  const [position, setPosition] = useState<AnchoredPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const compute = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let resolved: Side = side;
      if (side === 'bottom' && a.bottom + offset + ph > vh - GUTTER && a.top - offset - ph > GUTTER) resolved = 'top';
      if (side === 'top' && a.top - offset - ph < GUTTER && a.bottom + offset + ph < vh - GUTTER) resolved = 'bottom';
      if (side === 'right' && a.right + offset + pw > vw - GUTTER) resolved = 'left';
      if (side === 'left' && a.left - offset - pw < GUTTER) resolved = 'right';

      let top: number;
      let left: number;
      let originX = 'left';
      let originY = 'top';
      if (resolved === 'bottom' || resolved === 'top') {
        top = resolved === 'bottom' ? a.bottom + offset : a.top - offset - ph;
        originY = resolved === 'bottom' ? 'top' : 'bottom';
        if (align === 'start') left = a.left;
        else if (align === 'end') { left = a.right - pw; originX = 'right'; }
        else { left = a.left + a.width / 2 - pw / 2; originX = 'center'; }
      } else {
        left = resolved === 'right' ? a.right + offset : a.left - offset - pw;
        originX = resolved === 'right' ? 'left' : 'right';
        if (align === 'start') top = a.top;
        else if (align === 'end') { top = a.bottom - ph; originY = 'bottom'; }
        else { top = a.top + a.height / 2 - ph / 2; originY = 'center'; }
      }
      left = Math.min(Math.max(GUTTER, left), vw - pw - GUTTER);
      top = Math.min(Math.max(GUTTER, top), vh - Math.min(ph, vh - GUTTER * 2) - GUTTER);
      const maxHeight = resolved === 'bottom' ? vh - top - GUTTER : resolved === 'top' ? a.top - offset - GUTTER : vh - GUTTER * 2;
      setPosition({ top, left, side: resolved, origin: `${originX} ${originY}`, maxHeight });
    };
    compute();
    // A second pass after layout settles catches panels whose size depends on async content.
    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open, side, align, offset, anchorRef, panelRef]);

  return position;
}
