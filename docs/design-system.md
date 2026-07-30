# Design System — Sistema de Cobrança

> Documento vivo. Reflete o estado atual do código (`apps/web/src/app/globals.css` e `apps/web/tailwind.config.ts`). Se editar tokens/componentes, atualize este arquivo junto.

## Direção estética

Tech-imersivo (estilo Cursor/Linear), **dark como tema padrão**, com light disponível. Paleta atual é **monocromática prata/branco** (accent = branco no dark, preto no light) — sem cor de marca saturada no accent principal. Cores de status (sucesso/aviso/perigo) continuam saturadas para contraste semântico.

## Arquitetura de tokens

Tokens são **variáveis CSS em canais RGB** (`R G B` sem `rgb()`), definidas em `apps/web/src/app/globals.css`:

- `:root` e `[data-theme='dark']` — tema padrão
- `[data-theme='light']` — sobrescreve as mesmas variáveis

`apps/web/tailwind.config.ts` mapeia os tokens para classes `cc-*` via `rgb(var(--x) / <alpha-value>)`, o que permite opacidade nas classes Tailwind (ex.: `bg-cc-surface/95`) **e** faz com que trocar o tema re-skine toda a UI sem tocar nas telas.

### Troca de tema

`components/layout/ThemeToggle.tsx` seta `data-theme` no `<html>` e persiste em `localStorage['cc-theme']`. Um script inline anti-flash roda no `layout.tsx` antes da hidratação (permitido pela CSP via `unsafe-inline`).

## Tokens de cor

| Token Tailwind | Variável CSS | Dark (`#`) | Light (`#`) |
|---|---|---|---|
| `cc-bg` | `--bg` | `#0A0A0A` | `#FAFAFA` |
| `cc-surface` | `--surface` | `#171717` | `#FFFFFF` |
| `cc-surface-2` | `--surface-2` | `#262626` | `#F4F4F5` |
| `cc-hairline` | `--border` | `#2A2A2A` | `#E4E4E7` |
| `cc-ink` | `--text` | `#EDEDED` | `#111111` |
| `cc-ink-2` | `--text-secondary` | `#A1A1AA` | `#52525B` |
| `cc-muted` | `--text-muted` | `#71717A` | `#A1A1AA` |
| `cc-accent` | `--accent` | `#FFFFFF` | `#111111` |
| `cc-accent-hover` | `--accent-hover` | `#D4D4D8` | `#27272A` |
| `cc-accent-soft` | `--accent-soft` | `#27272A` | `#F4F4F5` |
| `cc-success` | `--success` | `#34D399` | `#059669` |
| `cc-warning` | `--warning` | `#FBBF24` | `#D97706` |
| `cc-danger` | `--danger` | `#F87171` | `#DC2626` |

Cada cor de status tem par `-soft` (fundo suave) para badges/alerts. `cc-accent-ring` e `--glow` controlam anéis de foco e brilhos (`shadow-cc-glow`).

Sombras: `shadow-cc-sm/md/lg` (via `--shadow-*`), `shadow-cc-glow` / `shadow-cc-glow-strong` (brilho do accent).

## Tipografia

- **Sans:** Outfit (`next/font/google`, var `--font-outfit`) — fonte da UI em geral.
- **Mono:** JetBrains Mono (var `--font-mono`) — usada em números via `.tabular` (`font-variant-numeric: tabular-nums`) e detalhes técnicos.
- Tamanho extra: `text-2xs` (`0.6875rem`) para labels/uppercase.

## Componentes utilitários (classes CSS, `@layer components`)

Definidos em `globals.css`, usados diretamente nas telas (não são componentes React):

| Classe | Uso |
|---|---|
| `.input` | Campo de formulário padrão |
| `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm` | Botões |
| `.field-label` | Label de campo (uppercase, tracking) |
| `.card`, `.card-interactive` | Card padrão / card com hover elevado + glow |
| `.badge`, `.badge-green`, `.badge-amber`, `.badge-red`, `.badge-slate` | Badges de status |
| `.page-header`, `.page-title` | Cabeçalho de página |
| `.link-action` | Link de ação inline |
| `.data-table` (+ `th`/`td`/`tbody tr`) | Tabela padrão com hover em linha |
| `.alert-error`, `.alert-success`, `.alert-warning` | Alertas |

## Utilitários visuais (`@layer utilities`)

- `.glass` — superfície translúcida com blur (headers)
- `.text-glow` / `.drop-glow` — brilho de texto/ícone com base em `--glow`
- `.silver-gradient` — gradiente metálico prata para logo/destaques (variante própria no light)
- `.skeleton` — placeholder de loading com shimmer deslizante
- `.progress-fill` / `.progress-stripes` — barra de progresso com listras animadas
- `.live-dot` — ponto pulsante para status "ao vivo"
- `.logo-3d-wrap` / `.logo-3d` (+ `.logo-3d-slow`) — rotação 3D do logo (`cc-spin-3d`)

Todas as animações respeitam `prefers-reduced-motion: reduce` (desativadas via media query).

## Componentes React de UI/layout

| Componente | Caminho | Função |
|---|---|---|
| `ThemeToggle` | `components/layout/ThemeToggle.tsx` | Alterna dark/light |
| `Sidebar` | `components/layout/Sidebar.tsx` | Navegação lateral — fixa no desktop, drawer no mobile, estado ativo por rota |
| `CommandPalette` | `components/layout/CommandPalette.tsx` | Paleta de comandos (⌘K), abre por atalho ou evento `cc:open-command` |
| `LogoCC` | `components/layout/LogoCC.tsx` | Logo (usa `fill="currentColor"`, cor = accent) |
| `Toast` / `ToastProvider` / `useToast` | `components/ui/Toast.tsx` | Notificações toast, montado em `providers.tsx` |
| `Skeleton` (`TableSkeleton`) | `components/ui/Skeleton.tsx` | Loading state com shimmer |
| `EmptyState` | `components/ui/EmptyState.tsx` | Estado vazio padronizado |
| `ConfirmDialog` | `components/ui/ConfirmDialog.tsx` | Confirmação de ações destrutivas |

## Convenções

- Nunca hardcodar cores nas telas — sempre usar classes `cc-*` (mapeadas para os tokens) para que o tema dark/light funcione automaticamente.
- Números/valores monetários e técnicos usam `.tabular` (JetBrains Mono, tabular-nums).
- Tabelas devem ter scroll horizontal em telas pequenas (ver commits recentes de fix mobile) para não cortar colunas de ações.
- Acessibilidade: `:focus-visible` global com outline no accent; todas as animações têm fallback `reduced-motion`.

## Histórico

- 2026-07-01: fundação de tokens + Login + sidebar responsiva + logo 3D, paleta inicial azul elétrico (`#3B82F6`/`#2563EB`).
- Estado atual (verificado 2026-07-18): paleta migrou para monocromática prata/branco no accent; fonte sans migrou de Inter para Outfit.
