/** @type {import('tailwindcss').Config} */
// Colors are declared as RGB channels so Tailwind opacity modifiers (bg-brand/10) work.
const withAlpha = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  // Hover styles only on devices that can hover (no sticky hover after a tap).
  future: { hoverOnlyWhenSupported: true },
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: withAlpha('--bg-canvas-rgb'),
        surface: {
          DEFAULT: withAlpha('--bg-surface-rgb'),
          elevated: withAlpha('--bg-elevated-rgb'),
          subtle: withAlpha('--bg-subtle-rgb'),
          muted: withAlpha('--bg-subtle-rgb'),
          secondary: withAlpha('--bg-elevated-rgb'),
        },
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: withAlpha('--border-default-rgb'),
          strong: withAlpha('--border-strong-rgb'),
        },
        content: {
          DEFAULT: withAlpha('--text-primary-rgb'),
          primary: withAlpha('--text-primary-rgb'),
          secondary: withAlpha('--text-secondary-rgb'),
          muted: withAlpha('--text-muted-rgb'),
        },
        prodigi: {
          green: '#2ee86b',
          hover: '#4dfb85',
          dim: 'rgba(46, 232, 107, 0.12)',
          border: 'rgba(46, 232, 107, 0.3)',
          ink: '#0a0a0a',
          surface: '#141414',
          elevated: '#1e1e1e',
        },
        brand: {
          DEFAULT: withAlpha('--accent-primary-rgb'),
          hover: withAlpha('--accent-hover-rgb'),
          subtle: 'var(--accent-subtle)',
          fg: withAlpha('--accent-text-rgb'),
        },
        success: {
          DEFAULT: withAlpha('--color-success-rgb'),
          bg: 'var(--color-success-bg)',
          border: 'var(--color-success-border)',
        },
        warning: {
          DEFAULT: withAlpha('--color-warning-rgb'),
          bg: 'var(--color-warning-bg)',
          border: 'var(--color-warning-border)',
        },
        danger: {
          DEFAULT: withAlpha('--color-danger-rgb'),
          bg: 'var(--color-danger-bg)',
          border: 'var(--color-danger-border)',
        },
        info: {
          DEFAULT: withAlpha('--color-info-rgb'),
          bg: 'var(--color-info-bg)',
          border: 'var(--color-info-border)',
        },
        primary: 'var(--color-bg-primary)',
        secondary: 'var(--color-bg-secondary)',
        accent: withAlpha('--accent-primary-rgb'),
      },
      // Bare `border`/`divide` utilities default to the theme border instead of Tailwind's gray-200.
      borderColor: {
        DEFAULT: withAlpha('--border-default-rgb'),
      },
      // Type floor: 11px. Replaces the ad-hoc text-[8px]..text-[11px] sizes.
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out-strong': 'var(--ease-in-out)',
        drawer: 'var(--ease-drawer)',
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.45' }],
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      // Tailwind v4 names already used across components.
      borderRadius: { xs: '2px' },
      backdropBlur: { xs: '2px' },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        subtle: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        elevated: 'var(--shadow-elevated)',
        modal: 'var(--shadow-modal)',
        'glow-brand': '0 0 20px -4px var(--accent-primary)',
      },
    },
  },
  plugins: [],
};
