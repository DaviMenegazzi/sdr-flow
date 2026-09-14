import React, { type HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'outline';
  size?: 'sm' | 'md';
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}: BadgeProps) {
  const baseStyles = 'inline-flex items-center gap-1 font-semibold rounded-md transition-colors';

  const variants = {
    default: 'bg-surface-elevated text-content-secondary border border-border',
    success: 'bg-success-bg text-success border border-success-border',
    warning: 'bg-warning-bg text-warning border border-warning-border',
    danger: 'bg-danger-bg text-danger border border-danger-border',
    info: 'bg-info-bg text-info border border-info-border',
    accent: 'bg-brand-subtle text-brand border border-brand/20',
    outline: 'bg-transparent text-content-secondary border border-border',
  };

  const sizes = {
    sm: 'text-[10px] px-1.5 py-0.5 leading-tight',
    md: 'text-xs px-2.5 py-0.5',
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </span>
  );
}
