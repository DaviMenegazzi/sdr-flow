import React, { forwardRef, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-content-primary select-none">
            {label}
          </label>
        )}
        <div className="relative flex items-center w-full">
          {leftIcon && (
            <div className="absolute left-3 text-content-muted pointer-events-none flex items-center">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={`w-full bg-surface text-content-primary border ${
              error ? 'border-danger focus:ring-danger' : 'border-border focus:border-brand focus:ring-brand/20'
            } rounded-lg text-xs py-2 px-3 outline-none transition-[color,background-color,border-color,box-shadow] duration-150 ease-out placeholder:text-content-muted focus:ring-2 disabled:opacity-50 disabled:bg-surface-subtle ${
              leftIcon ? 'pl-9' : ''
            } ${rightIcon ? 'pr-9' : ''} ${className}`}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 text-content-muted flex items-center">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <span className="text-2xs text-danger font-medium">{error}</span>
        ) : helperText ? (
          <span className="text-2xs text-content-muted">{helperText}</span>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
