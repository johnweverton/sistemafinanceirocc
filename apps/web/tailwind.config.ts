import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cc: {
          bg: '#f8fafc',
          surface: '#ffffff',
          ink: '#0f172a',
          'ink-2': '#475569',
          muted: '#94a3b8',
          hairline: '#e2e8f0',
          accent: '#0d9488',
          'accent-hover': '#0f766e',
          'accent-soft': '#f0fdfa',
          'accent-ring': 'rgba(13,148,136,0.25)',
          success: '#059669',
          'success-soft': '#f0fdf4',
          warning: '#d97706',
          'warning-soft': '#fffbeb',
          danger: '#dc2626',
          'danger-soft': '#fef2f2',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'cc-sm': '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        'cc-md': '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'cc-lg': '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.03)',
        'cc-focus': '0 0 0 3px rgba(13,148,136,0.18)',
      },
      borderRadius: {
        DEFAULT: '0.375rem',
      },
    },
  },
  plugins: [],
};

export default config;
