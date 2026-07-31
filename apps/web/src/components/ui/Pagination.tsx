'use client';

interface PaginationProps {
  /** Página atual, 1-based. */
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalItems, pageSize, onPageChange }: PaginationProps) {
  if (totalItems <= pageSize) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const inicio = (page - 1) * pageSize + 1;
  const fim = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm text-cc-muted">
      <span>
        Mostrando {inicio}–{fim} de {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost btn btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </button>
        <span className="px-1 text-cc-ink-2">
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          className="btn-ghost btn btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
