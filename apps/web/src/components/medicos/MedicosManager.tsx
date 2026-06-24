'use client';
import { useState } from 'react';
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
} from '@/services/medicos';
import { MedicoForm } from './MedicoForm';

type Modo = { tipo: 'lista' } | { tipo: 'novo' } | { tipo: 'editar'; medico: Medico };

export function MedicosManager() {
  const qc = useQueryClient();
  const [modo, setModo] = useState<Modo>({ tipo: 'lista' });
  const [erro, setErro] = useState<string | null>(null);

  const { data: medicos, isLoading } = useQuery({
    queryKey: queryKeys.medicos(),
    queryFn: () => medicosService.listar(),
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
      <section className="space-y-4">
        <Cabecalho titulo="Novo médico" onVoltar={() => setModo({ tipo: 'lista' })} />
        {erro && <Erro msg={erro} />}
        <MedicoForm
          salvando={criar.isPending}
          onSubmit={(dados) => criar.mutate(dados)}
        />
      </section>
    );
  }

  if (modo.tipo === 'editar') {
    return (
      <section className="space-y-4">
        <Cabecalho titulo={`Editar — ${modo.medico.nome}`} onVoltar={() => setModo({ tipo: 'lista' })} />
        {erro && <Erro msg={erro} />}
        <MedicoForm
          inicial={modo.medico}
          exigeMotivo
          salvando={atualizar.isPending}
          onSubmit={(dados, motivo) =>
            atualizar.mutate({ id: modo.medico.id, p: { ...dados, motivo } })
          }
        />
        <div className="pt-4">
          <Link href={`/medicos/${modo.medico.id}/historico`} className="text-sm text-blue-600 underline">
            Ver histórico de alterações
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Médicos</h1>
        <button
          onClick={() => {
            setErro(null);
            setModo({ tipo: 'novo' });
          }}
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white"
        >
          Novo médico
        </button>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Carregando…</p>
      ) : (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">CPF</th>
                <th className="px-3 py-2">TIPO</th>
                <th className="px-3 py-2">Modo</th>
                <th className="px-3 py-2">Ativo</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(medicos ?? []).map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{m.nome}</td>
                  <td className="px-3 py-2 font-mono">{m.cpf}</td>
                  <td className="px-3 py-2">{tipoSeguro(m)}</td>
                  <td className="px-3 py-2 uppercase">{m.modoMudancaData}</td>
                  <td className="px-3 py-2">{m.ativo ? 'Sim' : 'Não'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        setErro(null);
                        setModo({ tipo: 'editar', medico: m });
                      }}
                      className="text-blue-600 underline"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {(medicos ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    Nenhum médico cadastrado.
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

function tipoSeguro(m: Medico): string {
  try {
    return String(tipoDoMedico(m));
  } catch {
    return '—';
  }
}

function Cabecalho({ titulo, onVoltar }: { titulo: string; onVoltar: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">{titulo}</h1>
      <button onClick={onVoltar} className="text-sm text-gray-600 underline">
        Voltar
      </button>
    </div>
  );
}

function Erro({ msg }: { msg: string }) {
  return (
    <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
      {msg}
    </p>
  );
}
