import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name and tooltip text — required, an icon alone is not a label. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'outline' | 'danger';
  shortcut?: string;
  tooltip?: boolean;
}

/** Square icon-only button (28/32px) with a real tooltip instead of the native `title`. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, size = 'md', variant = 'ghost', shortcut, tooltip = true, className = '', ...props }, ref) => {
    const sizes = { sm: 'h-7 w-7', md: 'h-8 w-8' };
    const variants = {
      ghost: 'border-transparent bg-transparent text-content-secondary hover:bg-surface-elevated hover:text-content',
      outline: 'border-border bg-surface text-content-secondary hover:bg-surface-elevated hover:text-content',
      danger: 'border-transparent bg-transparent text-content-secondary hover:bg-danger/10 hover:text-danger',
    };
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={`press inline-flex min-h-0 flex-shrink-0 items-center justify-center rounded-lg border p-0 outline-none transition-[color,background-color,border-color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-40 ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {icon}
      </button>
    );
    return tooltip ? (
      <Tooltip content={label} shortcut={shortcut}>
        {button}
      </Tooltip>
    ) : (
      button
    );
  }
);

IconButton.displayName = 'IconButton';
