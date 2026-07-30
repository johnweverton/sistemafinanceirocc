interface ConfirmDialogProps {
  titulo: string;
  mensagem: string;
  itens?: string[];
  /**
   * 'danger' (padrão) — ação destrutiva irreversível (ex.: exclusão permanente): botão vermelho
   * + aviso fixo "NÃO PODE ser desfeita". 'neutral' — confirmação de uma ação permanente mas NÃO
   * destrutiva (ex.: vincular um registro, criar em lote): botão no tom padrão, sem o aviso de
   * exclusão — qualquer ressalva (como "o vínculo é permanente") deve vir na própria `mensagem`.
   */
  tone?: 'danger' | 'neutral';
  confirmLabel?: string;
  cancelLabel?: string;
  confirmandoLabel?: string;
  confirmando?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação de ação — destrutiva (`tone="danger"`, padrão) ou não (`tone="neutral"`). */
export function ConfirmDialog({
  titulo,
  mensagem,
  itens,
  tone = 'danger',
  confirmLabel,
  cancelLabel = 'Cancelar',
  confirmandoLabel,
  confirmando = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isDanger = tone === 'danger';
  const resolvedConfirmLabel = confirmLabel ?? (isDanger ? 'Excluir permanentemente' : 'Confirmar');
  const resolvedConfirmandoLabel = confirmandoLabel ?? (isDanger ? 'Excluindo...' : 'Confirmando...');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-cc-surface card w-full max-w-md shadow-2xl">
        <div className="border-b border-cc-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-cc-ink">{titulo}</h2>
        </div>
        <div className="space-y-3 px-6 py-4">
          <p className="text-sm text-cc-ink-2">{mensagem}</p>
          {itens && itens.length > 0 && (
            <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto rounded border border-cc-hairline bg-cc-surface-2 p-3 pl-7 text-xs text-cc-ink-2">
              {itens.map((nome, i) => (
                <li key={i}>{nome}</li>
              ))}
            </ul>
          )}
          {isDanger && (
            <p className="text-xs font-semibold text-cc-danger">
              Esta ação NÃO PODE ser desfeita.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
          <button onClick={onCancel} disabled={confirmando} className="btn-ghost btn btn-sm">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmando}
            className={`btn btn-sm ${isDanger ? 'btn-danger' : 'btn-primary'}`}
          >
            {confirmando ? resolvedConfirmandoLabel : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
