import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Braces } from 'lucide-react';
import { PROMPT_VARIABLES } from './types';

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

const MIRRORED = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'whiteSpace', 'wordWrap',
] as const;

/** Viewport position of the caret inside a textarea (mirror-div technique). */
function caretPosition(textarea: HTMLTextAreaElement, index: number) {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const key of MIRRORED) mirror.style[key] = style[key];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const rect = textarea.getBoundingClientRect();
  const top = rect.top + marker.offsetTop - textarea.scrollTop + parseFloat(style.lineHeight || '18');
  const left = rect.left + Math.min(marker.offsetLeft, rect.width - 240);
  document.body.removeChild(mirror);
  return { top, left };
}

/**
 * The agent's instructions are natural language, so they get a large editor in the normal font.
 * Typing "{{" opens the variable list at the cursor instead of a row of chips above the field.
 */
export function PromptEditor({ value, onChange, placeholder, id }: PromptEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ top: number; left: number; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState('');

  const options = PROMPT_VARIABLES.filter(v => `${v.token} ${v.label}`.toLowerCase().includes(filter.toLowerCase()));

  const insert = (token: string, start: number) => {
    const textarea = ref.current;
    if (!textarea) return;
    const end = textarea.selectionStart;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const detect = (textarea: HTMLTextAreaElement) => {
    const caret = textarea.selectionStart;
    const before = textarea.value.slice(0, caret);
    const open = before.lastIndexOf('{{');
    if (open === -1 || before.slice(open).includes('}}') || /\s/.test(before.slice(open + 2))) {
      setMenu(null);
      return;
    }
    setFilter(before.slice(open + 2));
    setActive(0);
    setMenu(current => (current && current.start === open ? current : { ...caretPosition(textarea, open), start: open }));
  };

  useLayoutEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu || !options.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(i => (i + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(i => (i - 1 + options.length) % options.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const option = options[active];
      if (option) insert(option.token, menu.start);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(null);
    }
  };

  const openMenuAtCursor = () => {
    const textarea = ref.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    textarea.focus();
    setFilter('');
    setActive(0);
    setMenu({ ...caretPosition(textarea, start), start });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
      <textarea
        id={id}
        ref={ref}
        value={value}
        onChange={event => {
          onChange(event.target.value);
          detect(event.target);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMenu(null), 120)}
        onClick={event => detect(event.currentTarget)}
        placeholder={placeholder}
        spellCheck
        className="block min-h-[420px] w-full resize-y border-0 bg-transparent px-4 py-3.5 text-sm leading-relaxed text-content outline-none placeholder:text-content-muted"
      />
      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-elevated/50 px-3 py-1.5 text-2xs text-content-muted">
        <button
          type="button"
          onMouseDown={event => event.preventDefault()}
          onClick={openMenuAtCursor}
          className="flex min-h-0 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-2xs text-content-secondary hover:bg-surface-elevated hover:text-content"
        >
          <Braces size={13} /> Inserir variável <kbd className="font-sans text-content-muted">{'{{'}</kbd>
        </button>
        <span className="tabular-nums">{value.length.toLocaleString('pt-BR')} caracteres</span>
      </div>

      {menu &&
        options.length > 0 &&
        createPortal(
          <div
            role="listbox"
            aria-label="Variáveis"
            className="motion-popover fixed z-[80] w-60 rounded-xl border border-border bg-surface p-1 shadow-elevated"
            style={{ top: menu.top + 4, left: menu.left }}
          >
            {options.map((option, index) => (
              <button
                key={option.token}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={event => event.preventDefault()}
                onClick={() => insert(option.token, menu.start)}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full min-h-0 items-center justify-between gap-2 rounded-lg border-0 px-2.5 py-1.5 text-left text-xs ${
                  index === active ? 'bg-surface-elevated text-content' : 'bg-transparent text-content-secondary'
                }`}
              >
                <span>{option.label}</span>
                <code className="text-2xs text-content-muted">{option.token}</code>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
