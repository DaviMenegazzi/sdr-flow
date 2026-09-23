import React, { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Popover } from './Popover';
import type { Align, Side } from './useAnchoredPosition';

export type MenuItem =
  | {
      type?: 'item';
      label: ReactNode;
      icon?: ReactNode;
      description?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      /** Shown next to a disabled item to explain why. */
      hint?: string;
      onSelect: () => void;
    }
  | { type: 'separator' }
  | { type: 'label'; label: ReactNode };

export interface DropdownMenuProps {
  trigger: ReactElement;
  items: MenuItem[];
  side?: Side;
  align?: Align;
  width?: number;
  /** Let the trigger fill its container (full-width triggers). */
  block?: boolean;
  'aria-label'?: string;
}

/** The "⋯" menu: occasional and destructive actions live here instead of as buttons on the row. */
export function DropdownMenu({ trigger, items, side = 'bottom', align = 'end', width = 220, block, ...aria }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const focusable = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = focusable();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list[list.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      side={side}
      align={align}
      width={width}
      role="menu"
      aria-label={aria['aria-label']}
      onKeyDown={onKeyDown}
      panelRef={panelRef}
      block={block}
      className="p-1"
    >
      {close =>
        items.map((item, index) => {
          if (item.type === 'separator') return <div key={index} role="separator" className="my-1 h-px bg-border" />;
          if (item.type === 'label')
            return (
              <div key={index} className="px-2.5 pb-1 pt-2 text-2xs font-medium text-content-muted">
                {item.label}
              </div>
            );
          return (
            <button
              key={index}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              title={item.disabled ? item.hint : undefined}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.onSelect();
              }}
              className={`menu-item flex w-full min-h-0 items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-xs outline-none ${
                item.disabled
                  ? 'cursor-not-allowed text-content-muted'
                  : item.danger
                  ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                  : 'text-content hover:bg-surface-elevated focus:bg-surface-elevated'
              }`}
            >
              {item.icon && <span className="flex w-4 flex-shrink-0 justify-center opacity-80">{item.icon}</span>}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.label}</span>
                {item.description && <span className="text-2xs text-content-muted">{item.description}</span>}
                {item.disabled && item.hint && <span className="text-2xs text-content-muted">{item.hint}</span>}
              </span>
              {item.shortcut && <kbd className="text-2xs text-content-muted">{item.shortcut}</kbd>}
            </button>
          );
        })
      }
    </Popover>
  );
}
