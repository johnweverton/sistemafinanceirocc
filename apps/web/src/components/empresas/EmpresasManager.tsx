'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Empresa } from '@cobranca/shared';
import { CONTA_EMISSORA_LABEL } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  empresasService,
  empresaQueryKeys,
  type NovaEmpresaPayload,
  type AtualizarEmpresaPayload,
  type ImportarResultado,
} from '@/services/empresas';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { EmpresaForm } from './EmpresaForm';

const PAGE_SIZE = 20;

type Modo = { tipo: 'lista' } | { tipo: 'nova' } | { tipo: 'editar'; empresa: Empresa };

export function EmpresasManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<Empresa | null>(null);
  const [importResult, setImportResult] = useState<ImportarResultado | null>(null);
  const [pagina, setPagina] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: empresas, isLoading, isError } = useQuery({
    queryKey: empresaQueryKeys.empresas(),
    queryFn: () => empresasService.listar(),
    retry: (count, err) => {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) return false;
      return count < 2;
    },
  });

  // Mantém a página dentro do intervalo válido quando a lista muda de tamanho (exclusão,
  // importação, ou carregamento inicial) — evita ficar numa página vazia.
  useEffect(() => {
    const total = empresas?.length ?? 0;
    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
    setPagina((atual) => Math.min(atual, totalPaginas));
  }, [empresas]);

  const criar = useMutation({
    mutationFn: (p: NovaEmpresaPayload) => empresasService.criar(p),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: empresaQueryKeys.empresas() });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Empresa ${e.nome} cadastrada`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const atualizar = useMutation({
    mutationFn: ({ id, p }: { id: string; p: AtualizarEmpresaPayload }) => empresasService.atualizar(id, p),
    onSuccess: (e, vars) => {
      void qc.invalidateQueries({ queryKey: empresaQueryKeys.empresas() });
      void qc.invalidateQueries({ queryKey: empresaQueryKeys.empresaHistorico(vars.id) });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Alterações de ${e.nome} salvas`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const importar = useMutation({
    mutationFn: (arquivo: File) => empresasService.importar(arquivo),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: empresaQueryKeys.empresas() });
      setImportResult(resultado);
      setErro(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (resultado.erros.length === 0) {
        toast(
          `${resultado.criados} empresa(s) importada(s), ${resultado.atualizados} atualizada(s)`,
          'success',
        );
      } else {
        toast(`Importação com ${resultado.erros.length} erro(s) — veja os detalhes`, 'info');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro na importação';
      setErro(msg);
      toast(msg, 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const excluir = useMutation({
    mutationFn: (id: string) => empresasService.excluir(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: empresaQueryKeys.empresas() });
      setConfirmacao(null);
      toast('Empresa excluída', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao excluir empresa';
      toast(msg, 'error');
    },
  });

  if (modo.tipo === 'nova') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Nova empresa" onVoltar={() => setModo({ tipo: 'lista' })} />
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <EmpresaForm salvando={criar.isPending} onSubmit={(dados) => criar.mutate(dados)} />
        </div>
      </section>
    );
  }

  if (modo.tipo === 'editar') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Editar empresa" onVoltar={() => setModo({ tipo: 'lista' })} />
        <p className="text-sm text-cc-ink-2 -mt-3">{modo.empresa.nome}</p>
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <EmpresaForm
            inicial={modo.empresa}
            exigeMotivo
            salvando={atualizar.isPending}
            onSubmit={(dados, motivo) => atualizar.mutate({ id: modo.empresa.id, p: { ...dados, motivo } })}
          />
        </div>
        <div>
          <Link href={`/empresas/${modo.empresa.id}/historico`} className="link-action">
            Ver histórico de alterações
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {confirmacao && (
        <ConfirmDialog
          titulo="Excluir empresa"
          mensagem={`Tem certeza que deseja excluir permanentemente "${confirmacao.nome}"? Bloqueado se houver médicos vinculados.`}
          confirmando={excluir.isPending}
          onCancel={() => setConfirmacao(null)}
          onConfirm={() => excluir.mutate(confirmacao.id)}
        />
      )}

      <div className="page-header">
        <h1 className="page-title">Empresas</h1>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/templates/empresas-modelo.xlsx" download className="btn btn-primary btn-sm">
            Baixar modelo Excel
          </a>
          <label className={`btn btn-primary btn-sm cursor-pointer ${importar.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {importar.isPending ? 'Importando...' : 'Importar Planilha'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={importar.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setImportResult(null);
                  setErro(null);
                  importar.mutate(f);
                }
              }}
            />
          </label>
          <button onClick={() => setModo({ tipo: 'nova' })} className="btn-primary btn btn-sm">
            Nova empresa
          </button>
        </div>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

      {importResult && (
        <div className={importResult.erros.length === 0 ? 'alert-success' : 'alert-warning'}>
          <p className="font-medium">
            Importação concluída: {importResult.criados} criada{importResult.criados !== 1 ? 's' : ''},{' '}
            {importResult.atualizados} atualizada{importResult.atualizados !== 1 ? 's' : ''}.
            {importResult.erros.length > 0 && ` ${importResult.erros.length} erro(s) encontrado(s).`}
          </p>
          {importResult.erros.length > 0 && (
            <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
              {importResult.erros.map((e) => (
                <li key={`${e.linha}-${e.chave}`}>
                  Linha {e.linha} ({e.chave}): {e.erro}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setImportResult(null)} className="mt-2 text-xs underline underline-offset-2">
            Fechar
          </button>
        </div>
      )}

      {!isLoading && !isError && empresas && empresas.length > 0 && (
        <p className="text-xs text-cc-muted">
          {empresas.length} empresa{empresas.length !== 1 ? 's' : ''}
        </p>
      )}

      {isLoading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : isError ? (
        <p className="alert-error" role="alert">Falha ao carregar empresas.</p>
      ) : !empresas || empresas.length === 0 ? (
        <EmptyState
          title="Nenhuma empresa cadastrada"
          description="Cadastre a primeira empresa (ex.: MEDISA) para agrupar produção de vários médicos."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cc-hairline text-left text-cc-muted">
                <th className="py-2.5 px-4 font-medium">Nome</th>
                <th className="py-2.5 px-4 font-medium">Conta emissora</th>
                <th className="py-2.5 px-4 font-medium">Regra de preço</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {empresas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-cc-hairline last:border-0 hover:bg-cc-surface-2/50 cursor-pointer"
                  onClick={() => setModo({ tipo: 'editar', empresa: e })}
                >
                  <td className="py-2.5 px-4 font-medium text-cc-ink">{e.nome}</td>
                  <td className="py-2.5 px-4 text-cc-ink-2">{CONTA_EMISSORA_LABEL[e.contaEmissora]}</td>
                  <td className="py-2.5 px-4 text-cc-ink-2">
                    {e.regraPreco ? (
                      <span className="badge-slate">{regraPrecoLabel(e.regraPreco.forma)}</span>
                    ) : (
                      <span className="text-cc-muted">Não configurada</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={e.ativo ? 'badge-green' : 'badge-slate'}>{e.ativo ? 'Ativa' : 'Inativa'}</span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setConfirmacao(e);
                      }}
                      className="text-xs font-medium text-cc-danger hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {empresas && empresas.length > 0 && (
        <Pagination page={pagina} totalItems={empresas.length} pageSize={PAGE_SIZE} onPageChange={setPagina} />
      )}
    </section>
  );
}

function regraPrecoLabel(forma: string): string {
  switch (forma) {
    case 'por_guia':
      return 'Por guia';
    case 'base_excedente':
      return 'Base + excedente';
    case 'fixo':
      return 'Valor fixo';
    default:
      return forma;
  }
}

function PageHeader({ titulo, onVoltar }: { titulo: string; onVoltar: () => void }) {
  return (
    <div className="page-header">
      <h1 className="page-title">{titulo}</h1>
      <button onClick={onVoltar} className="btn-ghost btn btn-sm">
        Voltar à lista
      </button>
    </div>
  );
}
