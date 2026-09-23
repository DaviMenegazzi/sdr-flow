import React, { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'accent';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'secondary',
      size = 'md',
      loading = false,
      disabled,
      className = '',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'press inline-flex min-h-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out rounded-lg outline-none select-none disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

    const variants = {
      primary:
        'bg-brand text-black dark:text-[#0a0a0a] font-semibold hover:bg-brand-hover shadow-sm border border-transparent',
      secondary:
        'bg-surface text-content-primary border border-border hover:bg-surface-elevated',
      outline:
        'bg-transparent text-content-primary border border-border hover:bg-surface-elevated',
      ghost:
        'bg-transparent border border-transparent text-content-secondary hover:text-content-primary hover:bg-surface-elevated',
      danger:
        'bg-danger text-canvas hover:opacity-90 shadow-sm border border-transparent',
      success:
        'bg-success text-canvas hover:bg-success/90 shadow-sm border border-transparent',
      accent:
        'bg-info text-canvas hover:bg-info/90 shadow-sm border border-transparent',
    };

    // Three sizes only (28 / 32 / 36) so buttons and inputs side by side always line up.
    const sizes = {
      sm: 'text-xs h-7 px-2.5',
      md: 'text-xs h-8 px-3',
      lg: 'text-sm h-9 px-4',
      icon: 'h-8 w-8 p-0',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
