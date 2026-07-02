import type { ReactNode } from 'react';

/** Estado vazio amigável: ícone + mensagem + ação opcional. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cc-hairline bg-cc-surface-2 text-cc-muted">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-cc-ink">{title}</p>
        {description && <p className="mt-1 text-sm text-cc-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
