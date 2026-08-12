// Execucao Orchestrator — cria a execução, divide os médicos ativos em lotes encadeados,
// processa lote a lote (Integration Client + Engine + repositório) e encadeia o próximo lote
// via chamada HTTP interna. Architecture: Core Workflows + Backend Architecture.
//
// Calibrado para 120-150 médicos/competência (volume real): BATCH_SIZE = 150 cobre a
// competência inteira em 1 lote só. Dentro do lote, os médicos são processados com
// concorrência limitada (EXECUCAO_CONCORRENCIA_MEDICO, default 8) em vez de sequencial —
// era aí que estava o gargalo real (1-2 chamadas de rede à API da Carmem por médico, em
// série). maxDuration de 300s (plano Vercel Pro) dá folga ampla mesmo com retries. O
// encadeamento em múltiplos lotes continua existindo como rede de segurança caso o volume
// cresça muito além disso ou a origem esteja degradada.
//
// As dependências de I/O (banco, rede, encadeamento HTTP) são injetáveis para permitir
// teste unitário com mocks sem tocar Supabase nem a API da Carmem.
import type {
  Execucao,
  Empresa,
  Medico,
  ItemProducao,
  ResultadoMedico,
  ExecucaoResultado,
  ClienteContabilidade,
  ClienteContabilidadeFaturamento,
} from '@cobranca/shared';
import { processarMedico } from '@/server/engine';
import { processarEmpresa, type ProducaoMedico } from '@/server/engine/processar-empresa';
import { aplicarRegraPreco } from '@/server/engine/regra-preco';
import { buscarItens } from '@/server/integration/fin-api-client';
import { buscarMedico, listarMedicosPorIds } from '@/server/repositories/medico-repository';
import { buscarEmpresa } from '@/server/repositories/empresa-repository';
import { buscarClienteContabilidade } from '@/server/repositories/cliente-contabilidade-repository';
import { buscarFaturamento } from '@/server/repositories/cliente-contabilidade-faturamento-repository';
import {
  criarExecucao,
  buscarExecucao,
  contarResultados,
  gravarResultado,
  gravarResultadoEmpresa,
  gravarResultadoClienteContabilidade,
  gravarContribuicoes,
  atualizarProgresso,
  concluirExecucao,
  marcarErro,
  guiasExecucaoAnterior,
  listarResultados,
  listarSelecoes,
} from '@/server/repositories/execucao-repository';
import { lerValorConsultaPediatria } from '@/server/repositories/config-cobranca-repository';
import { getServerEnv } from '@/lib/env';
import { ApiError } from '@/lib/api-error';
import { executarComLimite } from './concorrencia';

/**
 * Médicos por lote. Com processamento paralelo (concorrência limitada) dentro do lote,
 * 150 cobre a competência inteira (~120 médicos) numa única invocação, dentro do
 * maxDuration de 300s (architecture).
 */
export const BATCH_SIZE = 150;

export interface SelecaoDeps {
  execucaoId: string;
  medicoId: string;
  /** Null pra médico Angiologista (GATE 2026-08-07) — sem lote principal. */
  producaoExternaId: string | null;
  producaoNome: string | null;
  /** Produção de consultas de pediatria (Story 10.2) — opcional. */
  producaoConsultasExternaId?: string | null;
  producaoConsultasNome?: string | null;
  /** Lotes separados de Outros Hospitais/Imobilizações (Story 10.5) — opcionais. */
  producaoOutrosHospitaisExternaId?: string | null;
  producaoOutrosHospitaisNome?: string | null;
  producaoImobilizacoesExternaId?: string | null;
  producaoImobilizacoesNome?: string | null;
  /** Lotes de Cateter/Fístula/Angiografia (médico Angiologista, GATE 2026-08-07) — opcionais. */
  producaoCateterExternaId?: string | null;
  producaoCateterNome?: string | null;
  producaoFistulaExternaId?: string | null;
  producaoFistulaNome?: string | null;
  producaoAngiografiaExternaId?: string | null;
  producaoAngiografiaNome?: string | null;
  /** Carta de Rede (médico Angiologista, GATE 2026-08-12) — contagem MANUAL, sem itens da API. */
  producaoCartaRedeExternaId?: string | null;
  producaoCartaRedeNome?: string | null;
  cartaRedeGuias?: number | null;
}

export interface OrchestratorDeps {
  listarSelecoes: (execucaoId: string) => Promise<SelecaoDeps[]>;
  buscarMedico: (id: string) => Promise<Medico | null>;
  listarMedicosPorIds: (ids: string[]) => Promise<Medico[]>;
  /** Empresa de um resultado agregado (Story 10.4b). */
  buscarEmpresa: (id: string) => Promise<Empresa | null>;
  /** Cliente contábil de uma execução (Story 11.3). */
  buscarClienteContabilidade: (id: string) => Promise<ClienteContabilidade | null>;
  /** Faturamento lançado da competência (Story 11.2), usado no modo faixa_faturamento. */
  buscarFaturamentoClienteContabilidade: (
    clienteId: string,
    competencia: string,
  ) => Promise<ClienteContabilidadeFaturamento | null>;
  criarExecucao: (
    competencia: string,
    iniciadoPor: string,
    selecoes: {
      medicoId: string;
      producaoExternaId: string | null;
      producaoNome: string | null;
      producaoConsultasExternaId?: string | null;
      producaoConsultasNome?: string | null;
      producaoOutrosHospitaisExternaId?: string | null;
      producaoOutrosHospitaisNome?: string | null;
      producaoImobilizacoesExternaId?: string | null;
      producaoImobilizacoesNome?: string | null;
      producaoCateterExternaId?: string | null;
      producaoCateterNome?: string | null;
      producaoFistulaExternaId?: string | null;
      producaoFistulaNome?: string | null;
      producaoAngiografiaExternaId?: string | null;
      producaoAngiografiaNome?: string | null;
      producaoCartaRedeExternaId?: string | null;
      producaoCartaRedeNome?: string | null;
      cartaRedeGuias?: number | null;
    }[],
    empresaId?: string | null,
    clienteContabilidadeId?: string | null,
    ehAdicional?: boolean,
  ) => Promise<Execucao>;
  buscarExecucao: (id: string) => Promise<Execucao | null>;
  contarResultados: (execucaoId: string) => Promise<number>;
  gravarResultado: (execucaoId: string, medicoId: string | null, r: ResultadoMedico) => Promise<void>;
  /** Grava o resultado AGREGADO de uma empresa (Story 10.4b) — devolve o id do resultado. */
  gravarResultadoEmpresa: (
    execucaoId: string,
    empresaId: string,
    r: { nome: string; guias: number; totalValor: number; status: ExecucaoResultado['status']; alertas: string[]; subtotalFaixa: string },
  ) => Promise<string>;
  /** Grava o resultado (único, sem agregação) de um cliente contábil (Story 11.3). */
  gravarResultadoClienteContabilidade: (
    execucaoId: string,
    clienteContabilidadeId: string,
    r: { nome: string; totalValor: number; status: ExecucaoResultado['status']; alertas: string[]; subtotalFaixa: string },
  ) => Promise<string>;
  /** Grava a auditoria "qual médico contribuiu quanto" de um resultado agregado (Story 10.4b). */
  gravarContribuicoes: (
    execucaoResultadoId: string,
    contribuicoes: { medicoId: string; guias: number; valor: number }[],
  ) => Promise<void>;
  atualizarProgresso: (execucaoId: string, progresso: number) => Promise<void>;
  concluirExecucao: (
    execucaoId: string,
    totais: { totalOk: number; totalAlerta: number; totalSemDados: number; totalGeralValor: number },
  ) => Promise<void>;
  marcarErro: (execucaoId: string) => Promise<void>;
  guiasExecucaoAnterior: (medicoId: string, competenciaAtual: string) => Promise<number | null>;
  buscarItens: (producaoExternaId: string) => Promise<ItemProducao[]>;
  /** Valor unitário global da consulta pediátrica (Story 10.2), lido de config_cobranca. */
  lerValorConsultaPediatria: () => Promise<number>;
  /** Resultados já gravados — usado para agregar os totais ao concluir. */
  listarResultados: (execucaoId: string) => Promise<ResultadoMedico[]>;
  /** Encadeia o próximo lote (HTTP interno). Pode ser no-op em teste. */
  agendarProximoLote: (execucaoId: string) => Promise<void>;
  batchSize: number;
}

/** Dependências reais (produção). */
export function depsPadrao(): OrchestratorDeps {
  return {
    listarSelecoes,
    buscarMedico,
    listarMedicosPorIds,
    buscarEmpresa,
    buscarClienteContabilidade,
    buscarFaturamentoClienteContabilidade: buscarFaturamento,
    criarExecucao,
    buscarExecucao,
    contarResultados,
    gravarResultado,
    gravarResultadoEmpresa,
    gravarResultadoClienteContabilidade,
    gravarContribuicoes,
    atualizarProgresso,
    concluirExecucao,
    marcarErro,
    guiasExecucaoAnterior,
    buscarItens,
    lerValorConsultaPediatria,
    listarResultados: async (id) =>
      (await listarResultados(id)).map((r) => ({
        cpf: r.cpf,
        nome: r.nome,
        procedimentos: r.procedimentos ?? 0,
        cirurgias: r.cirurgias ?? 0,
        guias: r.guias ?? 0,
        guiasConsolidado: r.guiasConsolidado ?? 0,
        subtotais: r.subtotais ?? [],
        totalValor: r.totalValor ?? 0,
        status: r.status,
        alertas: r.alertas,
      })),
    agendarProximoLote: agendarProximoLoteHttp,
    batchSize: BATCH_SIZE,
  };
}

/**
 * Lógica pura de divisão em lotes: quantos lotes para um total dado um tamanho de lote.
 * Exportada para teste unitário direto (sem I/O).
 */
export function numeroDeLotes(total: number, batchSize: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total / batchSize);
}

/** Calcula o progresso (0-100) a partir de quantos médicos já foram processados. */
export function calcularProgresso(processados: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.round((processados / total) * 100));
}

/**
 * Cria a execução e dispara o primeiro lote (fire-and-forget no caller).
 * Responde imediatamente — não espera o processamento (PRD §6.3).
 */
export async function iniciarExecucao(
  competencia: string,
  selecoes: {
    medicoId: string;
    producaoExternaId: string | null;
    producaoNome: string | null;
    producaoConsultasExternaId?: string | null;
    producaoConsultasNome?: string | null;
    producaoOutrosHospitaisExternaId?: string | null;
    producaoOutrosHospitaisNome?: string | null;
    producaoImobilizacoesExternaId?: string | null;
    producaoImobilizacoesNome?: string | null;
    producaoCateterExternaId?: string | null;
    producaoCateterNome?: string | null;
    producaoFistulaExternaId?: string | null;
    producaoFistulaNome?: string | null;
    producaoAngiografiaExternaId?: string | null;
    producaoAngiografiaNome?: string | null;
    producaoCartaRedeExternaId?: string | null;
    producaoCartaRedeNome?: string | null;
    cartaRedeGuias?: number | null;
  }[],
  usuarioId: string,
  deps: OrchestratorDeps = depsPadrao(),
  /** Marca a execução como agregada por empresa (Story 10.4b) — null/ausente = execução normal. */
  empresaId?: string | null,
  /** Marca a execução como sendo de cliente contábil (Story 11.3) — null/ausente = execução normal. */
  clienteContabilidadeId?: string | null,
  /** Marca a execução como o boleto avulso do adicional semestral (Story 11.4). */
  ehAdicional?: boolean,
): Promise<Execucao> {
  // Cliente contábil não tem médicos/produção — caminho totalmente separado das validações de
  // seleção abaixo (mesmo espírito do branch de empresa, mas sem nada pra selecionar).
  if (clienteContabilidadeId) {
    if (empresaId) {
      throw new ApiError(422, 'Execução não pode ser de empresa e cliente contábil ao mesmo tempo', 'SELECAO_INVALIDA');
    }
    const cliente = await deps.buscarClienteContabilidade(clienteContabilidadeId);
    if (!cliente) throw new ApiError(422, 'Cliente contábil não encontrado', 'CLIENTE_CONTABILIDADE_NAO_ENCONTRADO');
    if (!cliente.ativo) throw new ApiError(422, 'Cliente contábil inativo', 'CLIENTE_CONTABILIDADE_INATIVO');
    if (ehAdicional && !cliente.adicionalAtivo) {
      throw new ApiError(422, 'Cliente contábil não tem adicional semestral ativo', 'ADICIONAL_NAO_ATIVO');
    }
    return deps.criarExecucao(competencia, usuarioId, [], null, clienteContabilidadeId, ehAdicional ?? false);
  }
  if (ehAdicional) {
    throw new ApiError(422, 'Adicional semestral só é válido para execução de cliente contábil', 'ADICIONAL_SEM_CLIENTE');
  }

  // QA M-1: validação server-side das seleções (defesa em profundidade — a UI já filtra,
  // mas o invariante da 0005 não pode depender só dela). Médico precisa existir, estar
  // ativo, configurado e vinculado à origem; medicoId duplicado é rejeitado.
  const ids = selecoes.map((s) => s.medicoId);
  const duplicados = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicados.length > 0) {
    throw new ApiError(422, 'Seleções duplicadas para o mesmo médico', 'SELECAO_DUPLICADA', {
      medicoIds: duplicados,
    });
  }

  const medicos = await deps.listarMedicosPorIds(ids);
  const porId = new Map(medicos.map((m) => [m.id, m]));
  const invalidos: string[] = [];
  for (const s of selecoes) {
    const m = porId.get(s.medicoId);
    if (!m) invalidos.push(`${s.medicoId}: médico não encontrado`);
    else if (!m.ativo) invalidos.push(`${m.nome}: inativo`);
    else if (m.necessitaConfiguracao) invalidos.push(`${m.nome}: cadastro pendente de configuração`);
    else if (!m.externalId) invalidos.push(`${m.nome}: sem vínculo com o sistema web`);
  }
  if (invalidos.length > 0) {
    throw new ApiError(422, 'Seleções inválidas para execução', 'SELECAO_INVALIDA', { invalidos });
  }

  if (empresaId) {
    const empresa = await deps.buscarEmpresa(empresaId);
    if (!empresa) throw new ApiError(422, 'Empresa não encontrada', 'EMPRESA_NAO_ENCONTRADA');
    if (!empresa.ativo) throw new ApiError(422, 'Empresa inativa', 'EMPRESA_INATIVA');

    // QA 10.4c-1 (mesma defesa em profundidade do QA M-1 acima): a UI só lista médicos vinculados
    // à empresa selecionada, mas o servidor não pode confiar só nisso — sem esta checagem, um
    // médico de fora do grupo entraria no agregado da empresa errada (dinheiro atribuído ao
    // pagador errado).
    const foraDoGrupo = selecoes
      .map((s) => porId.get(s.medicoId))
      .filter((m): m is Medico => m != null && m.empresaGrupoId !== empresaId)
      .map((m) => m.nome);
    if (foraDoGrupo.length > 0) {
      throw new ApiError(422, 'Seleções inválidas para execução por empresa', 'SELECAO_INVALIDA', {
        invalidos: foraDoGrupo.map((nome) => `${nome}: não vinculado a esta empresa`),
      });
    }
  }

  return deps.criarExecucao(competencia, usuarioId, selecoes, empresaId ?? null);
}

export interface ResultadoLote {
  concluido: boolean;
  processadosNoLote: number;
  progresso: number;
}

/**
 * Processa o próximo lote de médicos ativos. O cursor é "quantos resultados já existem".
 * Uma falha de rede num médico não trava a competência: vira alerta e segue (architecture).
 * Quando não há mais médicos, agrega os totais e conclui. Senão, agenda o próximo lote.
 */
export async function processarProximoLote(
  execucaoId: string,
  deps: OrchestratorDeps = depsPadrao(),
): Promise<ResultadoLote> {
  const execucao = await deps.buscarExecucao(execucaoId);
  if (!execucao) throw new Error(`Execução ${execucaoId} não encontrada`);

  // Story 10.4b: execução agregada por empresa é um caminho totalmente separado do fluxo
  // por-médico abaixo — sem lotes/encadeamento (grupos de empresa são pequenos, poucos
  // médicos), processada e concluída de uma vez só. Zero risco de regressão ao fluxo normal:
  // esta é a ÚNICA leitura de `execucao.empresaId` em todo o orquestrador.
  if (execucao.empresaId) {
    return processarExecucaoEmpresa(execucaoId, execucao.empresaId, deps);
  }

  // Story 11.3: mesmo espírito do branch de empresa acima — sem lotes, ainda mais simples (não
  // há médicos/produção para buscar, só a regra de preço do cliente + o faturamento lançado).
  // Única leitura de `execucao.clienteContabilidadeId` em todo o orquestrador.
  if (execucao.clienteContabilidadeId) {
    return processarExecucaoClienteContabilidade(
      execucaoId,
      execucao.clienteContabilidadeId,
      execucao.competencia,
      Boolean(execucao.ehAdicional),
      deps,
    );
  }

  const total = execucao.totalMedicos ?? 0;
  const jaProcessados = await deps.contarResultados(execucaoId);

  // Sem médicos, ou já processou todos → conclui.
  if (total === 0 || jaProcessados >= total) {
    await finalizar(execucaoId, deps);
    return { concluido: true, processadosNoLote: 0, progresso: 100 };
  }

  const todasSelecoes = await deps.listarSelecoes(execucaoId);
  const selecoesLote = todasSelecoes.slice(jaProcessados, jaProcessados + deps.batchSize);

  // Lido uma vez por lote (não por médico) — config global, singleton (Story 10.2).
  const valorConsultaPediatria = await deps.lerValorConsultaPediatria();

  // Busca todos os médicos do lote em 1 query (antes eram N idas ao banco, 1 por médico).
  const medicosDoLote = await deps.listarMedicosPorIds(selecoesLote.map((s) => s.medicoId));
  const medicosPorId = new Map(medicosDoLote.map((m) => [m.id, m]));

  // Processa o lote com concorrência limitada (antes era 100% sequencial — o gargalo real,
  // já que cada médico faz 1-2 chamadas de rede à API da Carmem). `processarUmMedico` nunca
  // rejeita (try/catch interno sempre grava um resultado), então a falha de 1 médico não
  // afeta os demais mesmo em paralelo.
  const concorrencia = getServerEnv().EXECUCAO_CONCORRENCIA_MEDICO;
  await executarComLimite(selecoesLote, concorrencia, (selecao) =>
    processarUmMedico(
      execucaoId,
      execucao.competencia,
      selecao,
      medicosPorId.get(selecao.medicoId) ?? null,
      deps,
      valorConsultaPediatria,
    ),
  );

  const processadosAgora = jaProcessados + selecoesLote.length;
  const progresso = calcularProgresso(processadosAgora, total);
  await deps.atualizarProgresso(execucaoId, progresso);

  const concluido = processadosAgora >= total;
  if (concluido) {
    await finalizar(execucaoId, deps);
    return { concluido: true, processadosNoLote: selecoesLote.length, progresso: 100 };
  }

  // Encadeia o próximo lote (HTTP interno). Não bloqueia a resposta deste lote.
  await deps.agendarProximoLote(execucaoId);
  return { concluido: false, processadosNoLote: selecoesLote.length, progresso };
}

/**
 * Processa um médico isolando falhas de rede (vira alerta, não derruba o lote).
 * `medico` já vem resolvido do lote inteiro (1 query em `processarProximoLote`), em vez de
 * uma busca individual por médico — elimina N-1 round-trips de banco por lote.
 */
async function processarUmMedico(
  execucaoId: string,
  competencia: string,
  selecao: SelecaoDeps,
  medico: Medico | null,
  deps: OrchestratorDeps,
  valorConsultaPediatria: number,
): Promise<void> {
  try {
    if (!medico) throw new Error('Médico não encontrado na base');

    // Angiologista não tem lote principal (GATE 2026-08-07) — producaoExternaId fica null pra
    // ele, `itens` fica vazio (o Engine desvia pro caminho de Cateter/Fístula/Angiografia).
    const itens = selecao.producaoExternaId ? await deps.buscarItens(selecao.producaoExternaId) : [];
    // Story 10.2: lote separado de consultas ambulatoriais (pediatria) — opcional, produção
    // distinta da de guias. NUNCA reaproveita `itens` (anti-dupla-contagem).
    const itensConsultas = selecao.producaoConsultasExternaId
      ? await deps.buscarItens(selecao.producaoConsultasExternaId)
      : undefined;
    // Story 10.5: lotes separados de Outros Hospitais/Imobilizações — cada um com sua própria
    // contagem e tabela de preço (o Engine nunca reaproveita a contagem de `itens` para essas
    // classes; ver processar-medico.ts). `undefined` quando o operador não selecionou o lote
    // nesta execução — o Engine gera alerta em vez de chutar.
    const itensOutrosHospitais = selecao.producaoOutrosHospitaisExternaId
      ? await deps.buscarItens(selecao.producaoOutrosHospitaisExternaId)
      : undefined;
    const itensImobilizacoes = selecao.producaoImobilizacoesExternaId
      ? await deps.buscarItens(selecao.producaoImobilizacoesExternaId)
      : undefined;
    // GATE 2026-08-07: lotes de Cateter/Fístula/Angiografia (médico Angiologista, sem lote
    // principal) — mesmo padrão de nunca-chuta de Outros Hospitais/Imobilizações acima.
    const itensCateter = selecao.producaoCateterExternaId
      ? await deps.buscarItens(selecao.producaoCateterExternaId)
      : undefined;
    const itensFistula = selecao.producaoFistulaExternaId
      ? await deps.buscarItens(selecao.producaoFistulaExternaId)
      : undefined;
    const itensAngiografia = selecao.producaoAngiografiaExternaId
      ? await deps.buscarItens(selecao.producaoAngiografiaExternaId)
      : undefined;
    // GATE 2026-08-12: Carta de Rede não busca itens da API — a contagem não tem regra fixa
    // (depende do procedimento realizado no mês), então o operador informa o número diretamente
    // (`carta_rede_guias`). `producaoCartaRedeExternaId` é só referência/auditoria, nunca lido aqui.
    const guiasCartaRede = selecao.cartaRedeGuias ?? undefined;

    // Variação anômala (PRD §8.5): busca guias da execução concluída anterior.
    const historicoGuias = await deps.guiasExecucaoAnterior(medico.id, competencia);
    const resultado = processarMedico(
      {
        medico,
        itens,
        historicoGuias,
        itensConsultas,
        itensOutrosHospitais,
        itensImobilizacoes,
        itensCateter,
        itensFistula,
        itensAngiografia,
        guiasCartaRede,
        competencia,
      },
      undefined,
      valorConsultaPediatria,
    );
    await deps.gravarResultado(execucaoId, medico.id, resultado);
  } catch (e) {
    // Falha de infraestrutura ao buscar dados — médico vira alerta, competência segue.
    await deps.gravarResultado(execucaoId, selecao.medicoId, {
      cpf: medico?.cpf ?? '',
      nome: medico?.nome ?? 'Médico Desconhecido',
      procedimentos: 0,
      cirurgias: 0,
      guias: 0,
      guiasConsolidado: 0,
      subtotais: [],
      totalValor: 0,
      status: 'alerta',
      alertas: [`Falha ao buscar dados. Tentar novamente. (${String(e)})`],
    });
  }
}

/**
 * Processa uma execução AGREGADA por empresa (Story 10.4b) de ponta a ponta, sem lotes: busca
 * a empresa e a produção de guias cardíacas de cada médico do grupo, roda o cálculo agregado
 * (Engine puro `processarEmpresa`), grava 1 resultado + N contribuições, e conclui a execução.
 * Falha de infraestrutura propaga (o chamador — `dispararPrimeiroLote` — converte em 'erro');
 * diferente do fluxo por-médico, aqui não há "isolar falha de 1 médico e seguir", porque o
 * resultado é um só para o grupo inteiro.
 */
async function processarExecucaoEmpresa(
  execucaoId: string,
  empresaId: string,
  deps: OrchestratorDeps,
): Promise<ResultadoLote> {
  const empresa = await deps.buscarEmpresa(empresaId);
  if (!empresa) throw new Error(`Empresa ${empresaId} não encontrada`);

  const selecoes = await deps.listarSelecoes(execucaoId);
  const medicos: ProducaoMedico[] = [];
  for (const selecao of selecoes) {
    const medico = await deps.buscarMedico(selecao.medicoId);
    // Angiologista (sem lote principal, GATE 2026-08-07) não faz sentido numa execução
    // agregada por empresa — guarda defensiva, não um caminho esperado em produção.
    const itens = selecao.producaoExternaId ? await deps.buscarItens(selecao.producaoExternaId) : [];
    medicos.push({ medicoId: selecao.medicoId, itens, especialidade: medico?.especialidade });
  }

  const resultado = processarEmpresa({ regraPreco: empresa.regraPreco, medicos });

  const resultadoId = await deps.gravarResultadoEmpresa(execucaoId, empresa.id, {
    nome: empresa.nome,
    guias: resultado.guias,
    totalValor: resultado.totalValor,
    status: resultado.status,
    alertas: resultado.alertas,
    subtotalFaixa: resultado.subtotalFaixa,
  });
  await deps.gravarContribuicoes(resultadoId, resultado.contribuicoes);

  await deps.atualizarProgresso(execucaoId, 100);
  await deps.concluirExecucao(execucaoId, {
    totalOk: resultado.status === 'ok' ? 1 : 0,
    totalAlerta: resultado.status === 'alerta' ? 1 : 0,
    totalSemDados: 0,
    totalGeralValor: resultado.totalValor,
  });

  return { concluido: true, processadosNoLote: selecoes.length, progresso: 100 };
}

/**
 * Processa uma execução de CLIENTE CONTÁBIL (Story 11.3) de ponta a ponta, sem lotes: não há
 * médicos nem produção — só a regra de preço do cliente e, no modo `faixa_faturamento`, o
 * faturamento já lançado da competência (Story 11.2). Mesmo mecanismo de `aplicarRegraPreco`
 * usado por médico/empresa, reaproveitado sem alteração. Falha de infraestrutura propaga (mesmo
 * comportamento de `processarExecucaoEmpresa` — não há "isolar 1 e seguir" pra um resultado só).
 */
async function processarExecucaoClienteContabilidade(
  execucaoId: string,
  clienteContabilidadeId: string,
  competencia: string,
  ehAdicional: boolean,
  deps: OrchestratorDeps,
): Promise<ResultadoLote> {
  const cliente = await deps.buscarClienteContabilidade(clienteContabilidadeId);
  if (!cliente) throw new Error(`Cliente contábil ${clienteContabilidadeId} não encontrado`);

  const resultado = await (async () => {
    // Adicional semestral (Story 11.4): valor à parte do cadastro, ignora modoCobranca/faturamento
    // — regra montada em memória (não é a `regraPreco` persistida do cliente).
    if (ehAdicional) {
      return aplicarRegraPreco(
        { forma: 'fixo', base: null, limiar: null, taxa: null, valorFixo: cliente.adicionalValor },
        0,
      );
    }
    if (cliente.modoCobranca === 'faixa_faturamento') {
      const faturamento = await deps.buscarFaturamentoClienteContabilidade(clienteContabilidadeId, competencia);
      if (!faturamento) {
        // Nunca chuta valor (PRD §2): sem faturamento lançado, alerta explícito — o operador
        // precisa lançar o faturamento (Story 11.2) antes de gerar o boleto desta competência.
        return {
          valor: 0,
          alertas: [`Faturamento não lançado para a competência ${competencia}. Lance antes de gerar o boleto.`],
          subtotalFaixa: '',
        };
      }
      return aplicarRegraPreco(cliente.regraPreco, faturamento.faturamento);
    }
    // modo 'fixo': valorFixo independe de qualquer quantidade (0 é ignorado por aplicarRegraPreco
    // nesta forma).
    return aplicarRegraPreco(cliente.regraPreco, 0);
  })();

  const status: ExecucaoResultado['status'] = resultado.alertas.length > 0 ? 'alerta' : 'ok';

  await deps.gravarResultadoClienteContabilidade(execucaoId, cliente.id, {
    nome: ehAdicional ? `${cliente.nome} (Adicional semestral)` : cliente.nome,
    totalValor: resultado.valor,
    status,
    alertas: resultado.alertas,
    subtotalFaixa: resultado.subtotalFaixa,
  });

  await deps.atualizarProgresso(execucaoId, 100);
  await deps.concluirExecucao(execucaoId, {
    totalOk: status === 'ok' ? 1 : 0,
    totalAlerta: status === 'alerta' ? 1 : 0,
    totalSemDados: 0,
    totalGeralValor: resultado.valor,
  });

  return { concluido: true, processadosNoLote: 1, progresso: 100 };
}

async function finalizar(execucaoId: string, deps: OrchestratorDeps): Promise<void> {
  const resultados = await deps.listarResultados(execucaoId);
  const totais = resultados.reduce(
    (acc, r) => {
      if (r.status === 'ok') acc.totalOk += 1;
      else if (r.status === 'alerta') acc.totalAlerta += 1;
      else acc.totalSemDados += 1;
      acc.totalGeralValor += r.totalValor;
      return acc;
    },
    { totalOk: 0, totalAlerta: 0, totalSemDados: 0, totalGeralValor: 0 },
  );
  await deps.concluirExecucao(execucaoId, totais);
}

/** Encadeamento real do próximo lote via HTTP interno protegido por X-Internal-Secret. */
async function agendarProximoLoteHttp(execucaoId: string): Promise<void> {
  const env = getServerEnv();
  if (!env.INTERNAL_SECRET || !env.APP_BASE_URL) {
    // Sem configuração de encadeamento — não pode auto-invocar. Lança para virar 'erro'.
    throw new Error('INTERNAL_SECRET/APP_BASE_URL não configurados para encadear lotes');
  }
  const url = new URL(`/api/execucoes/${execucaoId}/processar-lote`, env.APP_BASE_URL);
  // Fire-and-forget: dispara o próximo lote sem aguardar sua conclusão. Falha de rede/config
  // real (DNS, APP_BASE_URL errado etc.) é logada — não resolve o caso da function morta por
  // timeout no meio do processamento (isso não é um catch capturável), mas evita que uma falha
  // de encadeamento capturável desapareça silenciosamente sem deixar rastro nos logs.
  void fetch(url, {
    method: 'POST',
    headers: { 'X-Internal-Secret': env.INTERNAL_SECRET },
  }).catch((e) => {
    console.error('[execucao] falha ao encadear próximo lote', execucaoId, e);
  });
}

/** Helper para o Route Handler de disparo: marca erro se o primeiro lote estourar. */
export async function dispararPrimeiroLote(
  execucaoId: string,
  deps: OrchestratorDeps = depsPadrao(),
): Promise<void> {
  try {
    await processarProximoLote(execucaoId, deps);
  } catch {
    await deps.marcarErro(execucaoId);
  }
}
