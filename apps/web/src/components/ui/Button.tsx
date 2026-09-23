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
      'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 rounded-lg outline-none select-none disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

    const variants = {
      primary:
        'bg-brand text-black dark:text-[#0a0a0a] font-bold hover:bg-brand-hover shadow-sm border border-transparent active:scale-[0.98]',
      secondary:
        'bg-surface text-content-primary border border-border hover:bg-surface-elevated active:scale-[0.98]',
      outline:
        'bg-transparent text-content-primary border border-border hover:bg-surface-elevated',
      ghost:
        'bg-transparent text-content-secondary hover:text-content-primary hover:bg-surface-elevated',
      danger:
        'bg-danger text-canvas hover:opacity-90 shadow-sm border border-transparent',
      success:
        'bg-success text-canvas hover:bg-success/90 shadow-sm border border-transparent',
      accent:
        'bg-purple-600 text-white hover:bg-purple-700 shadow-sm border border-transparent',
    };

    const sizes = {
      sm: 'text-xs h-7 px-2.5 min-h-0',
      md: 'text-xs h-9 px-3.5',
      lg: 'text-sm h-10 px-4',
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
