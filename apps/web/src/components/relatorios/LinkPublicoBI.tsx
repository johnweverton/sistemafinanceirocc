'use client';
// Gestão dos links públicos do BI de Relatórios (Módulo de Relatórios) — criação, cópia e
// revogação. O token só é exibido/copiável na criação e enquanto o link segue válido; a rota
// pública valida token+revogação/expiração no server (buscarLinkValidoPorToken).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContaEmissora } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL, CONTAS_EMISSORAS_VALIDAS } from '@cobranca/shared';
import { relatoriosService, relatoriosQueryKeys } from '@/services/relatorios';
import { ApiClientError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';

function urlPublica(token: string): string {
  if (typeof window === 'undefined') return `/relatorios/publico/${token}`;
  return `${window.location.origin}/relatorios/publico/${token}`;
}

function statusLink(link: { revogadoEm: string | null; expiraEm: string | null }): {
  label: string;
  classe: string;
} {
  if (link.revogadoEm) return { label: 'Revogado', classe: 'badge-slate' };
  if (link.expiraEm && new Date(link.expiraEm).getTime() <= Date.now()) return { label: 'Expirado', classe: 'badge-slate' };
  return { label: 'Ativo', classe: 'badge-green' };
}

function NovoLinkDialog({
  criando,
  onConfirm,
  onCancel,
}: {
  criando: boolean;
  onConfirm: (input: { nome: string; escopoContaEmissora?: ContaEmissora; expiraEm?: string }) => void;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState('');
  const [escopo, setEscopo] = useState<ContaEmissora | ''>('');
  const [expiraEm, setExpiraEm] = useState('');

  const valido = nome.trim().length > 0;

  function submit() {
    if (!valido) return;
    onConfirm({
      nome: nome.trim(),
      escopoContaEmissora: escopo || undefined,
      expiraEm: expiraEm ? new Date(`${expiraEm}T23:59:59`).toISOString() : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Novo link público" className="bg-cc-surface card w-full max-w-lg shadow-2xl">
        <div className="border-b border-cc-hairline px-6 py-4">
          <h2 className="text-lg font-bold text-cc-ink">Novo link do BI</h2>
        </div>
        <div className="space-y-3 px-6 py-4">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome (ex.: BI da CEO)"
            className="input w-full"
            aria-label="Nome do link"
          />
          <select
            value={escopo}
            onChange={(e) => setEscopo(e.target.value as ContaEmissora | '')}
            className="input w-full"
            aria-label="Empresa (escopo)"
          >
            <option value="">Todas as empresas</option>
            {CONTAS_EMISSORAS_VALIDAS.map((c) => (
              <option key={c} value={c}>{CONTA_EMISSORA_LABEL[c]}</option>
            ))}
          </select>
          <div>
            <label className="mb-1 block text-xs font-medium text-cc-muted">Expira em (opcional)</label>
            <input
              value={expiraEm}
              onChange={(e) => setExpiraEm(e.target.value)}
              type="date"
              className="input w-full"
              aria-label="Data de expiração"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-cc-hairline px-6 py-4">
          <button onClick={onCancel} disabled={criando} className="btn-ghost btn btn-sm">
            Cancelar
          </button>
          <button onClick={submit} disabled={criando || !valido} className="btn-primary btn btn-sm">
            {criando ? 'Criando…' : 'Criar link'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LinkPublicoBI() {
  const [novoLink, setNovoLink] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const linksQ = useQuery({ queryKey: relatoriosQueryKeys.links(), queryFn: relatoriosService.links.listar });

  function erroToast(e: unknown, fallback: string) {
    toast(e instanceof ApiClientError ? e.message : fallback, 'error');
  }

  const criar = useMutation({
    mutationFn: relatoriosService.links.criar,
    onSuccess: (link) => {
      setNovoLink(false);
      void qc.invalidateQueries({ queryKey: relatoriosQueryKeys.links() });
      void navigator.clipboard?.writeText(urlPublica(link.token)).catch(() => {});
      toast('Link criado e copiado para a área de transferência.', 'success');
    },
    onError: (e) => erroToast(e, 'Erro ao criar link'),
  });

  const revogar = useMutation({
    mutationFn: (id: string) => relatoriosService.links.revogar(id),
    onSuccess: () => {
      toast('Link revogado.', 'success');
      void qc.invalidateQueries({ queryKey: relatoriosQueryKeys.links() });
    },
    onError: (e) => erroToast(e, 'Erro ao revogar link'),
  });

  function copiar(token: string) {
    void navigator.clipboard?.writeText(urlPublica(token)).then(
      () => toast('Link copiado.', 'success'),
      () => erroToast(null, 'Não foi possível copiar o link'),
    );
  }

  const links = linksQ.data ?? [];

  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-cc-ink">Link público do BI</h2>
        </div>
        <button onClick={() => setNovoLink(true)} className="btn-primary btn btn-sm">
          Novo link
        </button>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-cc-muted">Nenhum link criado ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Nome</th>
                <th>Empresa</th>
                <th>Status</th>
                <th>Último acesso</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => {
                const status = statusLink(link);
                return (
                  <tr key={link.id}>
                    <td>{link.nome}</td>
                    <td>{link.escopoContaEmissora ? CONTA_EMISSORA_LABEL[link.escopoContaEmissora] : 'Todas'}</td>
                    <td>
                      <span className={status.classe}>{status.label}</span>
                    </td>
                    <td>{link.ultimoAcessoEm ? new Date(link.ultimoAcessoEm).toLocaleString('pt-BR') : '—'}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => copiar(link.token)} className="btn-ghost btn btn-sm">
                          Copiar link
                        </button>
                        {!link.revogadoEm && (
                          <button
                            onClick={() => revogar.mutate(link.id)}
                            disabled={revogar.isPending}
                            className="btn-ghost btn btn-sm text-cc-danger"
                          >
                            Revogar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {novoLink && (
        <NovoLinkDialog criando={criar.isPending} onConfirm={(input) => criar.mutate(input)} onCancel={() => setNovoLink(false)} />
      )}
    </div>
  );
}
