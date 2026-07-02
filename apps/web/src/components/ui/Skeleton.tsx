/** Bloco de carregamento com brilho deslizante. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Esqueleto de tabela — replica a estrutura enquanto os dados carregam. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-cc-hairline bg-cc-surface-2 px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-cc-hairline">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              // primeira coluna mais larga (nome), demais menores — parece dado real
              <Skeleton key={c} className={c === 0 ? 'h-4 flex-[2]' : 'h-4 flex-1'} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
