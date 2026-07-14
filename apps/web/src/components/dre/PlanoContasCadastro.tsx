'use client';
// Cadastro do plano de contas + regras de categorização (Story 9.3, Épico 9). Escrita é
// admin-only no backend — esta tela NÃO esconde os controles por papel (mesmo padrão de
// ConfigCobrancaForm: confia no 403 do servidor, mostra o erro em toast).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CampoRegraCategorizacao, GrupoPlanoContas } from '@cobranca/shared';
import { GRUPOS_PLANO_CONTAS_VALIDOS, CAMPOS_REGRA_CATEGORIZACAO_VALIDOS } from '@cobranca/shared';
import { planoContasService, planoContasQueryKeys } from '@/services/plano-contas';
import { ApiClientError } from '@/lib/api-client';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const GRUPO_LABEL: Record<GrupoPlanoContas, string> = {
  receita: 'Receitas',
  deducao_receita: 'Deduções da Receita',
  despesa_operacional: 'Despesas Operacionais',
  despesa_financeira: 'Despesas Financeiras',
};

const CAMPO_LABEL: Record<CampoRegraCategorizacao, string> = {
  contraparte_nome: 'Contraparte',
  descricao: 'Descrição',
};

/** Mapeia os códigos de erro de negócio do plano de contas para uma mensagem clara — nunca genérica. */
function mensagemErroCategoria(e: unknown, fallback: string): string {
  if (e instanceof ApiClientError) {
    if (e.code === 'CATEGORIA_SISTEMA_PROTEGIDA') {
      return 'Esta é uma categoria de sistema (usada pela categorização automática) — não pode ser alterada nem excluída.';
    }
    if (e.code === 'CATEGORIA_EM_USO') {
      return 'Categoria em uso por transações ou lançamentos — desative em vez de excluir.';
    }
    if (e.code === 'CATEGORIA_INATIVA') {
      return 'Categoria já está desativada — exclusão física exige categoria ativa e sem uso.';
    }
    return e.message;
  }
  return fallback;
}

export function PlanoContasCadastro() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const categoriasQ = useQuery({
    queryKey: planoContasQueryKeys.categorias(),
    queryFn: () => planoContasService.listarCategorias(),
  });
  const regrasQ = useQuery({
    queryKey: planoContasQueryKeys.regras(),
    queryFn: () => planoContasService.listarRegras(),
  });

  function invalidarCategorias() {
    void qc.invalidateQueries({ queryKey: ['plano-contas', 'categorias'] });
  }
  function invalidarRegras() {
    void qc.invalidateQueries({ queryKey: ['plano-contas', 'regras'] });
  }
  function erroToast(e: unknown, fallback: string) {
    toast(mensagemErroCategoria(e, fallback), 'error');
  }

  // --- Categorias ---
  const [novoGrupo, setNovoGrupo] = useState<GrupoPlanoContas>('despesa_operacional');
  const [novoNome, setNovoNome] = useState('');
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState('');
  const [ordemEdit, setOrdemEdit] = useState('0');

  const criarCategoria = useMutation({
    mutationFn: () => planoContasService.criarCategoria({ grupo: novoGrupo, nome: novoNome.trim() }),
    onSuccess: () => {
      toast('Categoria criada.', 'success');
      setNovoNome('');
      invalidarCategorias();
    },
    onError: (e) => erroToast(e, 'Erro ao criar categoria'),
  });

  const atualizarCategoria = useMutation({
    mutationFn: (id: string) =>
      planoContasService.atualizarCategoria(id, { nome: nomeEdit.trim(), ordem: Number(ordemEdit) }),
    onSuccess: () => {
      toast('Categoria atualizada.', 'success');
      setEditandoId(null);
      invalidarCategorias();
    },
    onError: (e) => erroToast(e, 'Erro ao atualizar categoria'),
  });

  const desativarCategoria = useMutation({
    mutationFn: (id: string) => planoContasService.desativarCategoria(id),
    onSuccess: () => {
      toast('Categoria desativada.', 'success');
      invalidarCategorias();
    },
    onError: (e) => erroToast(e, 'Erro ao desativar categoria'),
  });

  const excluirCategoria = useMutation({
    mutationFn: (id: string) => planoContasService.excluirCategoria(id),
    onSuccess: () => {
      toast('Categoria excluída.', 'success');
      invalidarCategorias();
    },
    onError: (e) => erroToast(e, 'Erro ao excluir categoria'),
  });

  // --- Regras ---
  const [regraCategoriaId, setRegraCategoriaId] = useState('');
  const [regraCampo, setRegraCampo] = useState<CampoRegraCategorizacao>('descricao');
  const [regraPadrao, setRegraPadrao] = useState('');
  const [regraPrioridade, setRegraPrioridade] = useState('0');

  const criarRegra = useMutation({
    mutationFn: () =>
      planoContasService.criarRegra({
        categoriaId: regraCategoriaId,
        campo: regraCampo,
        padrao: regraPadrao.trim(),
        prioridade: Number(regraPrioridade) || 0,
      }),
    onSuccess: () => {
      toast('Regra criada.', 'success');
      setRegraPadrao('');
      invalidarRegras();
    },
    onError: (e) => erroToast(e, 'Erro ao criar regra'),
  });

  const desativarRegra = useMutation({
    mutationFn: (id: string) => planoContasService.desativarRegra(id),
    onSuccess: () => {
      toast('Regra desativada.', 'success');
      invalidarRegras();
    },
    onError: (e) => erroToast(e, 'Erro ao desativar regra'),
  });

  const excluirRegra = useMutation({
    mutationFn: (id: string) => planoContasService.excluirRegra(id),
    onSuccess: () => {
      toast('Regra excluída.', 'success');
      invalidarRegras();
    },
    onError: (e) => erroToast(e, 'Erro ao excluir regra'),
  });

  const categorias = categoriasQ.data ?? [];
  const categoriasAtivas = categorias.filter((c) => c.ativo);

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Plano de contas</h1>
      </div>

      {/* Categorias */}
      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-cc-ink">Categorias</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={novoGrupo}
            onChange={(e) => setNovoGrupo(e.target.value as GrupoPlanoContas)}
            className="input w-52"
            aria-label="Grupo da nova categoria"
          >
            {GRUPOS_PLANO_CONTAS_VALIDOS.map((g) => (
              <option key={g} value={g}>{GRUPO_LABEL[g]}</option>
            ))}
          </select>
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Nome da categoria"
            className="input flex-1"
            aria-label="Nome da nova categoria"
          />
          <button
            onClick={() => criarCategoria.mutate()}
            disabled={criarCategoria.isPending || !novoNome.trim()}
            className="btn-primary btn btn-sm"
          >
            Adicionar categoria
          </button>
        </div>

        {categoriasQ.isLoading ? (
          <Skeleton className="h-32" />
        ) : categorias.length === 0 ? (
          <p className="text-sm text-cc-muted">Nenhuma categoria cadastrada.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cc-hairline">
            <table className="data-table">
              <thead className="border-b border-cc-hairline bg-cc-surface-2">
                <tr>
                  <th>Grupo</th>
                  <th>Nome</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.id}>
                    <td>{GRUPO_LABEL[c.grupo]}</td>
                    <td>
                      {editandoId === c.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={nomeEdit}
                            onChange={(e) => setNomeEdit(e.target.value)}
                            className="input w-40"
                            aria-label={`Nome de ${c.nome}`}
                          />
                          <input
                            value={ordemEdit}
                            onChange={(e) => setOrdemEdit(e.target.value)}
                            type="number"
                            className="input w-20"
                            aria-label={`Ordem de ${c.nome}`}
                          />
                        </div>
                      ) : (
                        c.nome
                      )}
                    </td>
                    <td>
                      {c.sistema && <span className="badge-slate mr-1">Sistema</span>}
                      {!c.ativo && <span className="badge-amber">Inativa</span>}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {editandoId === c.id ? (
                          <>
                            <button
                              onClick={() => atualizarCategoria.mutate(c.id)}
                              disabled={atualizarCategoria.isPending}
                              className="btn-primary btn btn-sm"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditandoId(null)}
                              disabled={atualizarCategoria.isPending}
                              className="btn-ghost btn btn-sm"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditandoId(c.id);
                                setNomeEdit(c.nome);
                                setOrdemEdit(String(c.ordem));
                              }}
                              className="btn-ghost btn btn-sm"
                            >
                              Editar
                            </button>
                            {/* Categoria de sistema: backend sempre rejeita (400
                                CATEGORIA_SISTEMA_PROTEGIDA) — a UI nem oferece a ação. */}
                            {!c.sistema && c.ativo && (
                              <button
                                onClick={() => desativarCategoria.mutate(c.id)}
                                disabled={desativarCategoria.isPending}
                                className="btn-ghost btn btn-sm"
                              >
                                Desativar
                              </button>
                            )}
                            {!c.sistema && (
                              <button
                                onClick={() => excluirCategoria.mutate(c.id)}
                                disabled={excluirCategoria.isPending}
                                className="btn-ghost btn btn-sm text-cc-danger"
                              >
                                Excluir
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Regras */}
      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-cc-ink">Regras de categorização</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={regraCategoriaId}
            onChange={(e) => setRegraCategoriaId(e.target.value)}
            className="input w-48"
            aria-label="Categoria da nova regra"
          >
            <option value="">Categoria…</option>
            {categoriasAtivas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
          <select
            value={regraCampo}
            onChange={(e) => setRegraCampo(e.target.value as CampoRegraCategorizacao)}
            className="input w-36"
            aria-label="Campo da nova regra"
          >
            {CAMPOS_REGRA_CATEGORIZACAO_VALIDOS.map((c) => (
              <option key={c} value={c}>{CAMPO_LABEL[c]}</option>
            ))}
          </select>
          <input
            value={regraPadrao}
            onChange={(e) => setRegraPadrao(e.target.value)}
            placeholder="Padrão (ex.: aluguel)"
            className="input flex-1"
            aria-label="Padrão da nova regra"
          />
          <input
            value={regraPrioridade}
            onChange={(e) => setRegraPrioridade(e.target.value)}
            type="number"
            className="input w-24"
            aria-label="Prioridade da nova regra"
          />
          <button
            onClick={() => criarRegra.mutate()}
            disabled={criarRegra.isPending || !regraCategoriaId || !regraPadrao.trim()}
            className="btn-primary btn btn-sm"
          >
            Adicionar regra
          </button>
        </div>

        {regrasQ.isLoading ? (
          <Skeleton className="h-32" />
        ) : (regrasQ.data ?? []).length === 0 ? (
          <p className="text-sm text-cc-muted">Nenhuma regra cadastrada.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cc-hairline">
            <table className="data-table">
              <thead className="border-b border-cc-hairline bg-cc-surface-2">
                <tr>
                  <th>Categoria</th>
                  <th>Campo</th>
                  <th>Padrão</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(regrasQ.data ?? []).map((r) => {
                  const categoria = categorias.find((c) => c.id === r.categoriaId);
                  return (
                    <tr key={r.id}>
                      <td>{categoria?.nome ?? '—'}</td>
                      <td>{CAMPO_LABEL[r.campo]}</td>
                      <td className="font-mono text-2xs">{r.padrao}</td>
                      <td>{r.prioridade}</td>
                      <td>{!r.ativo && <span className="badge-amber">Inativa</span>}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r.ativo && (
                            <button
                              onClick={() => desativarRegra.mutate(r.id)}
                              disabled={desativarRegra.isPending}
                              className="btn-ghost btn btn-sm"
                            >
                              Desativar
                            </button>
                          )}
                          <button
                            onClick={() => excluirRegra.mutate(r.id)}
                            disabled={excluirRegra.isPending}
                            className="btn-ghost btn btn-sm text-cc-danger"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
