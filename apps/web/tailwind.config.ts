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
          navy:    '#01254c',
          blue:    '#4e628f',
          white:   '#ffffff',
          bg:      '#f3f6fb',
          surface: '#ffffff',
          ink:     '#01254c',
          'ink-2': '#4e628f',
          muted:   '#8898b8',
          hairline:'#dde3ee',
          'accent':       '#01254c',
          'accent-hover': '#012040',
          'accent-soft':  '#eaf0f8',
          'accent-ring':  'rgba(1,37,76,0.18)',
          success:       '#059669',
          'success-soft':'#f0fdf4',
          warning:       '#d97706',
          'warning-soft':'#fffbeb',
          danger:        '#dc2626',
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
        'cc-sm':    '0 1px 2px 0 rgb(1 37 76 / 0.06)',
        'cc-md':    '0 1px 3px 0 rgb(1 37 76 / 0.08), 0 1px 2px -1px rgb(1 37 76 / 0.05)',
        'cc-lg':    '0 4px 6px -1px rgb(1 37 76 / 0.07), 0 2px 4px -2px rgb(1 37 76 / 0.04)',
        'cc-focus': '0 0 0 3px rgba(1,37,76,0.15)',
      },
    },
  },
  plugins: [],
};

export default config;
