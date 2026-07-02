import type { Config } from 'tailwindcss';

// Tokens semânticos: as cores apontam para variáveis CSS (canais RGB) definidas em globals.css.
// Isso permite trocar o tema inteiro (dark/light) via [data-theme] sem tocar nas telas —
// os nomes `cc-*` continuam os mesmos, só a resolução muda por tema.
const withAlpha = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        cc: {
          // superfícies e texto
          bg:      withAlpha('--bg'),
          surface: withAlpha('--surface'),
          'surface-2': withAlpha('--surface-2'),
          ink:     withAlpha('--text'),
          'ink-2': withAlpha('--text-secondary'),
          blue:    withAlpha('--text-secondary'),
          muted:   withAlpha('--text-muted'),
          hairline: withAlpha('--border'),
          white:   '#ffffff',
          // marca / accent
          navy:          withAlpha('--accent'),
          accent:        withAlpha('--accent'),
          'accent-hover': withAlpha('--accent-hover'),
          'accent-soft':  withAlpha('--accent-soft'),
          'accent-ring':  'var(--accent-ring)',
          // status
          success:       withAlpha('--success'),
          'success-soft': withAlpha('--success-soft'),
          warning:       withAlpha('--warning'),
          'warning-soft': withAlpha('--warning-soft'),
          danger:        withAlpha('--danger'),
          'danger-soft':  withAlpha('--danger-soft'),
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'cc-sm':    'var(--shadow-sm)',
        'cc-md':    'var(--shadow-md)',
        'cc-lg':    'var(--shadow-lg)',
        'cc-focus': '0 0 0 3px var(--accent-ring)',
        'cc-glow':  '0 0 24px -4px var(--glow)',
        'cc-glow-strong': '0 0 40px -6px var(--glow)',
      },
      backgroundImage: {
        'cc-grid': 'var(--grid-bg)',
        'cc-radial': 'var(--radial-bg)',
      },
      keyframes: {
        'cc-fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'cc-pulse-glow': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'cc-fade-up': 'cc-fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'cc-pulse-glow': 'cc-pulse-glow 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
