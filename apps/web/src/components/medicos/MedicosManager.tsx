'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Medico } from '@cobranca/shared';
import { tipoDoMedico } from '@cobranca/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  medicosService,
  queryKeys,
  type NovoMedicoPayload,
  type AtualizarMedicoPayload,
  type ImportarResultado,
} from '@/services/medicos';
import { MedicoForm } from './MedicoForm';

type Modo = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editar'; medico: Medico };

export function MedicosManager() {
  const qc = useQueryClient();
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
    },
    onError: (e) => {
      setErro(e instanceof ApiClientError ? e.message : 'Erro na importacao');
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      setModo({ tipo: 'lista' });
      setErro(null);
    },
    onError: (e) => setErro(e instanceof ApiClientError ? e.message : 'Erro ao salvar'),
  });

  const atualizar = useMutation({
    mutationFn: ({ id, p }: { id: string; p: AtualizarMedicoPayload }) =>
      medicosService.atualizar(id, p),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.medicos() });
      void qc.invalidateQueries({ queryKey: queryKeys.medicoHistorico(vars.id) });
      setModo({ tipo: 'lista' });
      setErro(null);
    },
    onError: (e) => setErro(e instanceof ApiClientError ? e.message : 'Erro ao salvar'),
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
              atualizar.mutate({ id: modo.medico.id, p: { ...dados, motivo } })
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

      {isLoading ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-cc-muted">Carregando...</p>
        </div>
      ) : isError ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-cc-danger">Não foi possível carregar a lista de médicos. Recarregue a página.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead className="border-b border-cc-hairline bg-cc-bg/60">
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
                <tr key={m.id}>
                  <td className="font-medium">{m.nome}</td>
                  <td className="font-mono text-cc-ink-2 tabular">{formatCpf(m.cpf)}</td>
                  <td>
                    <span className="badge-slate">{tipoSeguro(m)}</span>
                  </td>
                  <td className="text-cc-ink-2">
                    {m.modoMudancaData === 'sim' ? 'Muda data' : 'Normal'}
                  </td>
                  <td>
                    {m.ativo ? (
                      <span className="badge-green">Ativo</span>
                    ) : (
                      <span className="badge-slate">Inativo</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => {
                        setErro(null);
                        setModo({ tipo: 'editar', medico: m });
                      }}
                      className="link-action"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {(medicos ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-cc-muted">
                    Nenhum médico cadastrado ainda.
                  </td>
                </tr>
              )}
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
