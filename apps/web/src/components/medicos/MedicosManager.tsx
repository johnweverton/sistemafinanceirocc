'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Medico } from '@cobranca/shared';
import { tipoDoMedico, cobrancaCompleta } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  medicosService,
  queryKeys,
  type NovoMedicoPayload,
  type AtualizarMedicoPayload,
  type ImportarResultado,
} from '@/services/medicos';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { MedicoForm } from './MedicoForm';

type Modo = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editar'; medico: Medico };

export function MedicosManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportarResultado | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importar = useMutation({
    mutationFn: (arquivo: File) => medicosService.importar(arquivo),
    onSuccess: (resultado) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setImportResult(resultado);
      setErro(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (resultado.erros.length === 0) {
        toast(`${resultado.criados} médico(s) importado(s) com sucesso`, 'success');
      } else {
        toast(`Importação com ${resultado.erros.length} erro(s) — veja os detalhes`, 'info');
      }
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro na importacao';
      setErro(msg);
      toast(msg, 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const { data: medicos, isLoading, isError } = useQuery({
    queryKey: queryKeys.medicos(),
    queryFn: () => medicosService.listar(),
    retry: (count, err) => {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) return false;
      return count < 2;
    },
  });

  const criar = useMutation({
    mutationFn: (p: NovoMedicoPayload) => medicosService.criar(p),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Médico ${m.nome} cadastrado`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  const atualizar = useMutation({
    mutationFn: ({ id, p }: { id: string; p: AtualizarMedicoPayload }) =>
      medicosService.atualizar(id, p),
    onSuccess: (m, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      void qc.invalidateQueries({ queryKey: queryKeys.medicoHistorico(vars.id) });
      setModo({ tipo: 'lista' });
      setErro(null);
      toast(`Alterações de ${m.nome} salvas`, 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao salvar';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  if (modo.tipo === 'novo') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Novo médico" onVoltar={() => setModo({ tipo: 'lista' })} />
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <MedicoForm salvando={criar.isPending} onSubmit={(dados) => criar.mutate(dados)} />
        </div>
      </section>
    );
  }

  if (modo.tipo === 'editar') {
    return (
      <section className="space-y-6">
        <PageHeader titulo="Editar médico" onVoltar={() => setModo({ tipo: 'lista' })} />
        <p className="text-sm text-cc-ink-2 -mt-3">{modo.medico.nome}</p>
        {erro && <p role="alert" className="alert-error">{erro}</p>}
        <div className="card p-6">
          <MedicoForm
            inicial={modo.medico}
            exigeMotivo
            salvando={atualizar.isPending}
            onSubmit={(dados, motivo) =>
              atualizar.mutate({
                id: modo.medico.id,
                p: {
                  ...dados,
                  motivo,
                  // Se era stub, marca como configurado ao salvar
                  ...(modo.medico.necessitaConfiguracao ? { necessitaConfiguracao: false } : {}),
                },
              })
            }
          />
        </div>
        <div>
          <Link href={`/medicos/${modo.medico.id}/historico`} className="link-action">
            Ver histórico de alterações
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Médicos</h1>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/templates/medicos-modelo.csv"
            download
            className="btn btn-secondary btn-sm"
          >
            Baixar modelo CSV
          </a>
          <label className={`btn btn-secondary btn-sm cursor-pointer ${importar.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {importar.isPending ? 'Importando...' : 'Importar CSV'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
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
          <button
            onClick={() => {
              setErro(null);
              setImportResult(null);
              setModo({ tipo: 'novo' });
            }}
            className="btn-primary btn-sm btn"
          >
            Novo médico
          </button>
        </div>
      </div>

      {erro && <p role="alert" className="alert-error">{erro}</p>}

      {importResult && (
        <div className={importResult.erros.length === 0 ? 'alert-success' : 'alert-warning'}>
          <p className="font-medium">
            Importação concluída: {importResult.criados} criado{importResult.criados !== 1 ? 's' : ''}.
            {importResult.erros.length > 0 && ` ${importResult.erros.length} erro(s) encontrado(s).`}
          </p>
          {importResult.erros.length > 0 && (
            <ul className="mt-2 list-disc pl-4 space-y-1 text-xs">
              {importResult.erros.map((e) => (
                <li key={`${e.linha}-${e.cpf}`}>
                  Linha {e.linha} (CPF {e.cpf}): {e.erro}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setImportResult(null)} className="mt-2 text-xs underline underline-offset-2">
            Fechar
          </button>
        </div>
      )}

      {/* Banner: médicos aguardando configuração */}
      {(() => {
        const pendentes = (medicos ?? []).filter((m) => m.necessitaConfiguracao);
        if (pendentes.length === 0) return null;
        return (
          <div className="alert-warning flex items-start gap-3">
            <span className="mt-0.5 text-base">!</span>
            <div>
              <p className="font-medium">
                {pendentes.length} médico{pendentes.length !== 1 ? 's' : ''} descoberto{pendentes.length !== 1 ? 's' : ''} via sistema da Carmem aguardam configuração.
              </p>
              <p className="mt-0.5 text-xs opacity-80">
                Configure os parâmetros de faturamento para que entrem no próximo cálculo.
              </p>
            </div>
          </div>
        );
      })()}

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : isError ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-cc-danger">Não foi possível carregar a lista de médicos. Recarregue a página.</p>
        </div>
      ) : (medicos ?? []).length === 0 ? (
        <EmptyState
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          title="Nenhum médico cadastrado ainda"
          description="Cadastre manualmente ou importe uma planilha CSV para começar."
          action={
            <button onClick={() => setModo({ tipo: 'novo' })} className="btn-primary btn-sm btn">
              Novo médico
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-surface-2">
              <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Tipo</th>
                <th>Modo</th>
                <th>Status</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(medicos ?? []).map((m) => (
                <tr
                  key={m.id}
                  onClick={() => {
                    setErro(null);
                    setModo({ tipo: 'editar', medico: m });
                  }}
                  className={`cursor-pointer ${m.necessitaConfiguracao ? 'opacity-70' : ''}`}
                >
                  <td className="font-medium">{m.nome}</td>
                  <td className="font-mono text-cc-ink-2 tabular">{formatCpf(m.cpf)}</td>
                  <td>
                    {m.necessitaConfiguracao ? (
                      <span className="badge-amber">Aguarda config</span>
                    ) : (
                      <span className="badge-slate">{tipoSeguro(m)}</span>
                    )}
                  </td>
                  <td className="text-cc-ink-2">
                    {m.necessitaConfiguracao ? '-' : m.modoMudancaData === 'sim' ? 'Muda data' : 'Normal'}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {m.necessitaConfiguracao ? (
                        <span className="badge-amber">Pendente</span>
                      ) : m.ativo ? (
                        <span className="badge-green">Ativo</span>
                      ) : (
                        <span className="badge-slate">Inativo</span>
                      )}
                      {!m.necessitaConfiguracao && !cobrancaCompleta(m) && (
                        <span className="badge-amber" title="Dados de cobrança incompletos — não emite boleto">
                          Cobrança ⚠
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="text-right">
                    <span className="link-action">
                      {m.necessitaConfiguracao ? 'Configurar' : 'Editar'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function tipoSeguro(m: Medico): string {
  try {
    return String(tipoDoMedico(m));
  } catch {
    return 'n/d';
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
