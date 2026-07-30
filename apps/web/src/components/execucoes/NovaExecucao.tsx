'use client';
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { execucoesService, execucaoQueryKeys, type ExecucaoSelecaoPayload } from '@/services/execucoes';
import { empresasService, empresaQueryKeys } from '@/services/empresas';
import { ProgressoExecucao } from './ProgressoExecucao';
import { RelatorioGrupos } from './RelatorioGrupos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';
import { useToast } from '@/components/ui/Toast';

/** Mesmo critério usado em MedicoForm.tsx e no Engine (isPediatra) — checagem local, sem I/O. */
function isPediatraEspecialidade(especialidade: string | null | undefined): boolean {
  return especialidade?.toLowerCase().includes('pediat') ?? false;
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

type Modo = 'competencia' | 'medico' | 'empresa';

// "VH"/"Credenciado" são os rótulos que o time usa no dia a dia; tecnicamente mapeiam para o
// enum `statusHapvida` já existente (mesma tradução usada em derivarStatusHapvida/medico-sync.ts:
// "Produção VH" da origem → 'nao_credenciado', "Produção Credenciada" → 'credenciado').
type FiltroTipoMedico = 'todos' | 'vh' | 'credenciado' | 'nenhum';
const STATUS_HAPVIDA_POR_FILTRO: Record<Exclude<FiltroTipoMedico, 'todos'>, string> = {
  vh: 'nao_credenciado',
  credenciado: 'credenciado',
  nenhum: 'nenhum',
};

export function NovaExecucao() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modo, setModo] = useState<Modo>('competencia');
  const [competencia, setCompetencia] = useState('');
  // Filtro por tipo (modo "Por competência") — permite disparar só os VH, só os credenciados etc.
  const [filtroTipoMedico, setFiltroTipoMedico] = useState<FiltroTipoMedico>('todos');
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Custom manual selections (modo "Por competência")
  const [manualSelections, setManualSelections] = useState<Record<string, string>>({});
  // Produção de consultas de pediatria (Story 10.2) — sempre manual, nunca auto-match
  // (evita heurística arriscada sobre nome de produção numa mudança que afeta valor cobrado).
  const [consultaSelections, setConsultaSelections] = useState<Record<string, string>>({});
  // Lotes separados de Outros Hospitais/Imobilizações (Story 10.5) — sempre manual, mesmo
  // motivo do consultaSelections acima: nunca auto-match numa seleção que afeta valor cobrado.
  const [outrosHospitaisSelections, setOutrosHospitaisSelections] = useState<Record<string, string>>({});
  const [imobilizacoesSelections, setImobilizacoesSelections] = useState<Record<string, string>>({});

  // Seleção do modo "Por médico"
  const [medicoId, setMedicoId] = useState('');
  const [producaoId, setProducaoId] = useState('');
  const [consultaProducaoId, setConsultaProducaoId] = useState('');
  const [outrosHospitaisProducaoId, setOutrosHospitaisProducaoId] = useState('');
  const [imobilizacoesProducaoId, setImobilizacoesProducaoId] = useState('');

  // Seleção do modo "Por empresa" (Story 10.4c) — empresa + produção de guias cardíacas de
  // cada médico vinculado, sempre manual (mesmo padrão da 10.2 — nunca auto-match).
  const [empresaId, setEmpresaId] = useState('');
  const [empresaProducaoSelecoes, setEmpresaProducaoSelecoes] = useState<Record<string, string>>({});

  const { data: apoio, isLoading: isApoioLoading } = useQuery({
    queryKey: execucaoQueryKeys.apoio(),
    queryFn: execucoesService.apoio,
  });

  const { data: empresas, isLoading: isEmpresasLoading } = useQuery({
    queryKey: empresaQueryKeys.empresas(),
    queryFn: () => empresasService.listar(),
  });
  const empresasAtivas = (empresas ?? []).filter((e) => e.ativo);

  const { medicos, producoes } = useMemo(() => {
    if (!apoio) return { medicos: [], producoes: [] };
    const prods = apoio.clientesOrigem.flatMap(c =>
      c.producoes.map(p => ({ ...p, clienteId: c.id, clienteNome: c.nome }))
    );
    return { medicos: apoio.medicos, producoes: prods };
  }, [apoio]);

  const { validMedicos, invalidMedicos } = useMemo(() => {
    return {
      validMedicos: medicos.filter(m => m.ativo && !m.necessitaConfiguracao && m.externalId),
      invalidMedicos: medicos.filter(m => !m.ativo || m.necessitaConfiguracao || !m.externalId),
    };
  }, [medicos]);

  // Contagem por tipo, para exibir no seletor (ex.: "VH (42)") — só considera médicos elegíveis.
  const contagemPorTipo = useMemo(() => {
    const contagem = { vh: 0, credenciado: 0, nenhum: 0 };
    for (const m of validMedicos) {
      if (m.statusHapvida === 'nao_credenciado') contagem.vh += 1;
      else if (m.statusHapvida === 'credenciado') contagem.credenciado += 1;
      else contagem.nenhum += 1;
    }
    return contagem;
  }, [validMedicos]);

  const medicosParaCompetencia = useMemo(() => {
    if (filtroTipoMedico === 'todos') return validMedicos;
    const status = STATUS_HAPVIDA_POR_FILTRO[filtroTipoMedico];
    return validMedicos.filter((m) => m.statusHapvida === status);
  }, [validMedicos, filtroTipoMedico]);

  const producoesDoMedicoSelecionado = useMemo(() => {
    const medico = validMedicos.find(m => m.id === medicoId);
    if (!medico) return [];
    return producoes.filter(p => p.clienteId === medico.externalId);
  }, [medicoId, validMedicos, producoes]);

  // Derived selections (modo "Por competência")
  const selecoesInfo = useMemo(() => {
    const matched: Array<{ medico: any; producao: any }> = [];
    const unmatched: Array<{ medico: any; producoesDisponiveis: any[] }> = [];
    const finalPayload: ExecucaoSelecaoPayload[] = [];

    const mesesNfd = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const compValida = /^\d{4}-\d{2}$/.test(competencia);
    const split = compValida ? competencia.split('-') : ['', ''];
    const ano = split[0] || '';
    const mes = split[1] || '';
    const mesIndex = compValida ? parseInt(mes, 10) - 1 : -1;
    const mesNome = mesIndex >= 0 ? (mesesNfd[mesIndex] || '') : '';

    for (const med of medicosParaCompetencia) {
      const producoesDoMedico = producoes.filter(p => p.clienteId === med.externalId);
      const manualProdId = manualSelections[med.id];

      if (manualProdId === 'IGNORE') {
        unmatched.push({ medico: med, producoesDisponiveis: producoesDoMedico });
        continue;
      }

      let match = producoesDoMedico.find(p => p.id === manualProdId);

      // Auto-match
      if (!match && compValida) {
        match = producoesDoMedico.find(p => {
          const norm = normalizeName(p.nome);
          const hasData = norm.includes(`${ano}-${mes}`) || norm.includes(`${mes}/${ano}`) || norm.includes(`${mes}-${ano}`);
          const hasExtenso = norm.includes(mesNome) && norm.includes(ano);
          return hasData || hasExtenso;
        });
      }

      if (match) {
        matched.push({ medico: med, producao: match });
        // Story 10.2: produção de consultas é sempre escolha manual do operador (nunca
        // auto-match) — só entra no payload se o pediatra tiver uma selecionada.
        const consultaProdId = consultaSelections[med.id];
        const consultaProd = consultaProdId
          ? producoesDoMedico.find((p) => p.id === consultaProdId)
          : undefined;
        // Story 10.5: mesmo mecanismo acima para os lotes separados de Outros
        // Hospitais/Imobilizações — sempre manual, nunca auto-match (afeta valor cobrado).
        const outrosHospitaisProdId = outrosHospitaisSelections[med.id];
        const outrosHospitaisProd = outrosHospitaisProdId
          ? producoesDoMedico.find((p) => p.id === outrosHospitaisProdId)
          : undefined;
        const imobilizacoesProdId = imobilizacoesSelections[med.id];
        const imobilizacoesProd = imobilizacoesProdId
          ? producoesDoMedico.find((p) => p.id === imobilizacoesProdId)
          : undefined;
        finalPayload.push({
          medicoId: med.id,
          producaoExternaId: match.id,
          producaoNome: match.nome,
          ...(consultaProd
            ? { producaoConsultasExternaId: consultaProd.id, producaoConsultasNome: consultaProd.nome }
            : {}),
          ...(outrosHospitaisProd
            ? {
                producaoOutrosHospitaisExternaId: outrosHospitaisProd.id,
                producaoOutrosHospitaisNome: outrosHospitaisProd.nome,
              }
            : {}),
          ...(imobilizacoesProd
            ? {
                producaoImobilizacoesExternaId: imobilizacoesProd.id,
                producaoImobilizacoesNome: imobilizacoesProd.nome,
              }
            : {}),
        });
      } else {
        unmatched.push({ medico: med, producoesDisponiveis: producoesDoMedico });
      }
    }

    return { matched, unmatched, finalPayload };
  }, [
    medicosParaCompetencia,
    producoes,
    manualSelections,
    consultaSelections,
    outrosHospitaisSelections,
    imobilizacoesSelections,
    competencia,
  ]);

  const disparar = useMutation({
    mutationFn: (vars: { competencia: string; selecoes: ExecucaoSelecaoPayload[]; empresaId?: string }) =>
      execucoesService.disparar(vars.competencia, vars.selecoes, vars.empresaId),
    onSuccess: ({ execucaoId }) => {
      setExecucaoId(execucaoId);
      setErro(null);
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucoes() });
      toast('Execução iniciada — acompanhe o progresso', 'success');
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao disparar execução';
      setErro(msg);
      toast(msg, 'error');
    },
  });

  if (execucaoId) {
    return <Acompanhamento execucaoId={execucaoId} onNova={() => setExecucaoId(null)} />;
  }

  const competenciaValida = /^\d{4}-\d{2}$/.test(competencia);
  const canDispararCompetencia = competenciaValida && selecoesInfo.finalPayload.length > 0 && !disparar.isPending;

  const producaoSelecionada = producoesDoMedicoSelecionado.find(p => p.id === producaoId);
  const canDispararMedico = Boolean(medicoId && producaoSelecionada && competenciaValida) && !disparar.isPending;

  // Story 10.4c: médicos vinculados à empresa selecionada (Story 10.4a — empresaGrupoId).
  const medicosDaEmpresa = validMedicos.filter((m) => m.empresaGrupoId === empresaId);
  const empresaSelecoesPayload: ExecucaoSelecaoPayload[] = medicosDaEmpresa
    .map((m) => {
      const producoesDoMedico = producoes.filter((p) => p.clienteId === m.externalId);
      const prodId = empresaProducaoSelecoes[m.id];
      const prod = prodId ? producoesDoMedico.find((p) => p.id === prodId) : undefined;
      return prod ? { medicoId: m.id, producaoExternaId: prod.id, producaoNome: prod.nome } : null;
    })
    .filter((s): s is ExecucaoSelecaoPayload => s != null);
  const canDispararEmpresa =
    Boolean(empresaId) &&
    empresaSelecoesPayload.length > 0 &&
    empresaSelecoesPayload.length === medicosDaEmpresa.length &&
    competenciaValida &&
    !disparar.isPending;

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Nova execução</h1>
      </div>

      <div className="inline-flex rounded-lg border border-cc-hairline bg-cc-surface-2 p-1">
        <button
          onClick={() => setModo('competencia')}
          className={`btn btn-sm ${modo === 'competencia' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Por competência
        </button>
        <button
          onClick={() => setModo('medico')}
          className={`btn btn-sm ${modo === 'medico' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Por médico
        </button>
        <button
          onClick={() => setModo('empresa')}
          className={`btn btn-sm ${modo === 'empresa' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Por empresa
        </button>
      </div>

      {modo === 'empresa' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="card p-6 space-y-4">
              <div>
                <label htmlFor="empresa-select" className="field-label mb-1.5">
                  Empresa
                </label>
                <select
                  id="empresa-select"
                  className="input"
                  value={empresaId}
                  onChange={(e) => {
                    setEmpresaId(e.target.value);
                    setEmpresaProducaoSelecoes({});
                  }}
                  disabled={isEmpresasLoading}
                >
                  <option value="">-- Selecione uma empresa --</option>
                  {empresasAtivas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-cc-muted">
                  Agrupa a produção de guias cardíacas (ou análoga) dos médicos vinculados a esta empresa (Story 10.4) num único boleto.
                </p>
              </div>

              <div>
                <label htmlFor="competencia-empresa" className="field-label mb-1.5">
                  Competência
                </label>
                <input
                  id="competencia-empresa"
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                  placeholder="2026-06"
                  className="input font-mono"
                  maxLength={7}
                />
                <p className="mt-1.5 text-xs text-cc-muted">Formato: AAAA-MM (Ex: 2026-05)</p>
              </div>

              {erro && <p role="alert" className="alert-error">{erro}</p>}

              <button
                onClick={() =>
                  disparar.mutate({ competencia, selecoes: empresaSelecoesPayload, empresaId })
                }
                disabled={!canDispararEmpresa}
                className="btn-primary w-full py-2.5"
              >
                {disparar.isPending ? 'Disparando...' : `Processar empresa (${empresaSelecoesPayload.length}/${medicosDaEmpresa.length} médicos)`}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4">Médicos vinculados</h2>
              {!empresaId ? (
                <p className="text-sm text-cc-muted italic">Selecione uma empresa para ver os médicos vinculados.</p>
              ) : medicosDaEmpresa.length === 0 ? (
                <p className="text-sm text-cc-muted italic">Nenhum médico vinculado a esta empresa (cadastro em Médicos → Empresa de agrupamento).</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                  {medicosDaEmpresa.map((m) => {
                    const producoesDoMedico = producoes.filter((p) => p.clienteId === m.externalId);
                    return (
                      <div key={m.id} className="p-2 bg-cc-surface rounded border border-cc-border space-y-1.5">
                        <span className="text-sm font-medium">{m.nome}</span>
                        <select
                          className="input text-xs py-1 h-auto w-full"
                          value={empresaProducaoSelecoes[m.id] ?? ''}
                          onChange={(e) =>
                            setEmpresaProducaoSelecoes((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                          aria-label={`Produção de guias cardíacas de ${m.nome}`}
                        >
                          <option value="">
                            {producoesDoMedico.length === 0 ? '-- Sem produções na origem --' : '-- Selecione a produção --'}
                          </option>
                          {producoesDoMedico.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : modo === 'medico' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="card p-6 space-y-4">
              <div>
                <label htmlFor="medico-select" className="field-label mb-1.5">
                  Médico
                </label>
                <select
                  id="medico-select"
                  className="input"
                  value={medicoId}
                  onChange={(e) => {
                    setMedicoId(e.target.value);
                    setProducaoId('');
                    setConsultaProducaoId('');
                    setOutrosHospitaisProducaoId('');
                    setImobilizacoesProducaoId('');
                  }}
                  disabled={isApoioLoading}
                >
                  <option value="">-- Selecione um médico --</option>
                  {validMedicos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="producao-select" className="field-label mb-1.5">
                  Produção
                </label>
                <select
                  id="producao-select"
                  className="input"
                  value={producaoId}
                  onChange={(e) => setProducaoId(e.target.value)}
                  disabled={!medicoId}
                >
                  <option value="">
                    {medicoId ? '-- Selecione a produção --' : 'Selecione um médico primeiro'}
                  </option>
                  {producoesDoMedicoSelecionado.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
                {medicoId && producoesDoMedicoSelecionado.length === 0 && (
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Este médico não tem produções disponíveis na origem.
                  </p>
                )}
              </div>

              {medicoId && isPediatraEspecialidade(validMedicos.find((m) => m.id === medicoId)?.especialidade) && (
                <div>
                  <label htmlFor="producao-consultas-select" className="field-label mb-1.5">
                    Produção de consultas <span className="font-normal normal-case text-cc-muted">(opcional)</span>
                  </label>
                  <select
                    id="producao-consultas-select"
                    className="input"
                    value={consultaProducaoId}
                    onChange={(e) => setConsultaProducaoId(e.target.value)}
                  >
                    <option value="">-- Sem componente de consultas --</option>
                    {producoesDoMedicoSelecionado
                      .filter((p) => p.id !== producaoId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Se este pediatra tem um lote separado de consultas ambulatoriais (Story 10.2), selecione aqui para somar ao valor de guias.
                  </p>
                </div>
              )}

              {medicoId && validMedicos.find((m) => m.id === medicoId)?.fazOutrosHospitais && (
                <div>
                  <label htmlFor="producao-outros-hospitais-select" className="field-label mb-1.5">
                    Lote de Outros Hospitais
                  </label>
                  <select
                    id="producao-outros-hospitais-select"
                    className="input"
                    value={outrosHospitaisProducaoId}
                    onChange={(e) => setOutrosHospitaisProducaoId(e.target.value)}
                  >
                    <option value="">-- Selecione o lote --</option>
                    {producoesDoMedicoSelecionado
                      .filter((p) => p.id !== producaoId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Este médico faz Outros Hospitais (Story 10.5) — produção SEPARADA da normal, com tabela de preço própria. Sem selecionar, essas guias NÃO são cobradas (o motor gera alerta em vez de chutar).
                  </p>
                </div>
              )}

              {medicoId && validMedicos.find((m) => m.id === medicoId)?.fazImobilizacoes && (
                <div>
                  <label htmlFor="producao-imobilizacoes-select" className="field-label mb-1.5">
                    Lote de Imobilizações
                  </label>
                  <select
                    id="producao-imobilizacoes-select"
                    className="input"
                    value={imobilizacoesProducaoId}
                    onChange={(e) => setImobilizacoesProducaoId(e.target.value)}
                  >
                    <option value="">-- Selecione o lote --</option>
                    {producoesDoMedicoSelecionado
                      .filter((p) => p.id !== producaoId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Este médico faz Imobilizações (Story 10.5) — produção SEPARADA da normal, com tabela de preço própria. Sem selecionar, essas guias NÃO são cobradas (o motor gera alerta em vez de chutar).
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="competencia-medico" className="field-label mb-1.5">
                  Competência
                </label>
                <input
                  id="competencia-medico"
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                  placeholder="2026-06"
                  className="input font-mono"
                  maxLength={7}
                />
                <p className="mt-1.5 text-xs text-cc-muted">Formato: AAAA-MM (Ex: 2026-05)</p>
              </div>

              {erro && <p role="alert" className="alert-error">{erro}</p>}

              <button
                onClick={() => {
                  if (!producaoSelecionada) return;
                  const consultaProd = producoesDoMedicoSelecionado.find((p) => p.id === consultaProducaoId);
                  const outrosHospitaisProd = producoesDoMedicoSelecionado.find(
                    (p) => p.id === outrosHospitaisProducaoId,
                  );
                  const imobilizacoesProd = producoesDoMedicoSelecionado.find(
                    (p) => p.id === imobilizacoesProducaoId,
                  );
                  disparar.mutate({
                    competencia,
                    selecoes: [
                      {
                        medicoId,
                        producaoExternaId: producaoSelecionada.id,
                        producaoNome: producaoSelecionada.nome,
                        ...(consultaProd
                          ? { producaoConsultasExternaId: consultaProd.id, producaoConsultasNome: consultaProd.nome }
                          : {}),
                        ...(outrosHospitaisProd
                          ? {
                              producaoOutrosHospitaisExternaId: outrosHospitaisProd.id,
                              producaoOutrosHospitaisNome: outrosHospitaisProd.nome,
                            }
                          : {}),
                        ...(imobilizacoesProd
                          ? {
                              producaoImobilizacoesExternaId: imobilizacoesProd.id,
                              producaoImobilizacoesNome: imobilizacoesProd.nome,
                            }
                          : {}),
                      },
                    ],
                  });
                }}
                disabled={!canDispararMedico}
                className="btn-primary w-full py-2.5"
              >
                {disparar.isPending ? 'Disparando...' : 'Processar médico'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="card p-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canDispararCompetencia) {
                    disparar.mutate({ competencia, selecoes: selecoesInfo.finalPayload });
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="filtro-tipo-medico" className="field-label mb-1.5">
                    Tipo de médico
                  </label>
                  <select
                    id="filtro-tipo-medico"
                    className="input"
                    value={filtroTipoMedico}
                    onChange={(e) => setFiltroTipoMedico(e.target.value as FiltroTipoMedico)}
                  >
                    <option value="todos">Todos ({validMedicos.length})</option>
                    <option value="vh">VH ({contagemPorTipo.vh})</option>
                    <option value="credenciado">Credenciado ({contagemPorTipo.credenciado})</option>
                    <option value="nenhum">Nenhum ({contagemPorTipo.nenhum})</option>
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Restringe a competência abaixo a um tipo específico (ex.: só os VH).
                  </p>
                </div>

                <div>
                  <label htmlFor="competencia" className="field-label mb-1.5">
                    Competência
                  </label>
                  <input
                    id="competencia"
                    name="competencia"
                    value={competencia}
                    onChange={(e) => setCompetencia(e.target.value)}
                    placeholder="2026-06"
                    className="input font-mono"
                    maxLength={7}
                  />
                  <p className="mt-1.5 text-xs text-cc-muted">Formato: AAAA-MM (Ex: 2026-05)</p>
                </div>

                {erro && <p role="alert" className="alert-error">{erro}</p>}

                <button
                  type="submit"
                  disabled={!canDispararCompetencia}
                  className="btn-primary w-full py-2.5"
                >
                  {disparar.isPending ? 'Disparando...' : `Processar ${selecoesInfo.finalPayload.length} médicos`}
                </button>
              </form>
            </div>

            {!isApoioLoading && invalidMedicos.length > 0 && (
              <div className="card p-4 border-amber-200 bg-amber-50/50">
                <h3 className="font-medium text-amber-800 text-sm mb-2">
                  Fora da Execução ({invalidMedicos.length})
                </h3>
                <p className="text-xs text-amber-700 mb-3">
                  Completar cadastro ou vínculo destes médicos para poder executá-los.
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {invalidMedicos.map(m => (
                    <div key={m.id} className="text-xs text-amber-900 bg-amber-100/50 p-1.5 rounded flex justify-between items-center">
                      <span className="truncate mr-2">{m.nome}</span>
                      <span className="shrink-0 opacity-75">
                        {!m.ativo ? 'Inativo' : m.necessitaConfiguracao ? 'Pend. Config' : 'Sem Vínculo'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4">Seleção de Médicos</h2>
              {isApoioLoading ? (
                <p className="text-cc-muted">Carregando dados de apoio...</p>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium text-cc-ink mb-2">
                      ✅ Prontos para processar ({selecoesInfo.matched.length})
                    </h3>
                    {selecoesInfo.matched.length === 0 ? (
                      <p className="text-sm text-cc-muted italic">Nenhum médico pareado para esta competência.</p>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                        {selecoesInfo.matched.map(({ medico, producao }) => {
                          const producoesDoMedico = producoes.filter((p) => p.clienteId === medico.externalId);
                          const outrasProducoes = producoesDoMedico.filter((p) => p.id !== producao.id);
                          const pediatra = isPediatraEspecialidade(medico.especialidade);
                          return (
                            <div key={medico.id} className="p-2 bg-cc-surface rounded border border-cc-border space-y-1.5">
                              <div className="flex justify-between items-center text-sm">
                                <span className="font-medium">{medico.nome}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-cc-muted text-xs bg-cc-border/30 px-2 py-0.5 rounded truncate max-w-[200px]">
                                    {producao.nome}
                                  </span>
                                  <button
                                    onClick={() => setManualSelections(prev => ({ ...prev, [medico.id]: 'IGNORE' }))}
                                    className="text-red-500 hover:text-red-700 p-1"
                                    title="Remover desta execução"
                                  >
                                    &times;
                                  </button>
                                </div>
                              </div>
                              {/* Story 10.2: produção de consultas de pediatria — sempre manual */}
                              {pediatra && outrasProducoes.length > 0 && (
                                <select
                                  className="input text-xs py-1 h-auto w-full"
                                  value={consultaSelections[medico.id] ?? ''}
                                  onChange={(e) =>
                                    setConsultaSelections((prev) => ({ ...prev, [medico.id]: e.target.value }))
                                  }
                                  aria-label={`Produção de consultas de ${medico.nome} (opcional)`}
                                >
                                  <option value="">+ Produção de consultas (opcional)</option>
                                  {outrasProducoes.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nome}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {/* Story 10.5: lote separado de Outros Hospitais — sempre manual (nunca
                                  auto-match, afeta valor cobrado). Sem lote selecionado, o motor gera
                                  alerta e NÃO cobra a classe (nunca reaproveita a produção principal). */}
                              {medico.fazOutrosHospitais && outrasProducoes.length > 0 && (
                                <select
                                  className="input text-xs py-1 h-auto w-full"
                                  value={outrosHospitaisSelections[medico.id] ?? ''}
                                  onChange={(e) =>
                                    setOutrosHospitaisSelections((prev) => ({ ...prev, [medico.id]: e.target.value }))
                                  }
                                  aria-label={`Lote de Outros Hospitais de ${medico.nome}`}
                                >
                                  <option value="">+ Lote de Outros Hospitais (obrigatório p/ cobrar)</option>
                                  {outrasProducoes.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nome}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {medico.fazImobilizacoes && outrasProducoes.length > 0 && (
                                <select
                                  className="input text-xs py-1 h-auto w-full"
                                  value={imobilizacoesSelections[medico.id] ?? ''}
                                  onChange={(e) =>
                                    setImobilizacoesSelections((prev) => ({ ...prev, [medico.id]: e.target.value }))
                                  }
                                  aria-label={`Lote de Imobilizações de ${medico.nome}`}
                                >
                                  <option value="">+ Lote de Imobilizações (obrigatório p/ cobrar)</option>
                                  {outrasProducoes.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nome}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selecoesInfo.unmatched.length > 0 && (
                    <div className="pt-4 border-t border-cc-border">
                      <h3 className="font-medium text-amber-600 mb-2">
                        ⚠️ Vínculo manual pendente ({selecoesInfo.unmatched.length})
                      </h3>
                      <p className="text-xs text-cc-muted mb-3">Estes médicos possuem vínculo com a origem, mas nenhuma produção correspondente foi auto-identificada.</p>
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                        {selecoesInfo.unmatched.map(({ medico, producoesDisponiveis }) => (
                          <div key={medico.id} className="flex flex-col gap-2 p-2 bg-amber-50 rounded border border-amber-200">
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-sm text-amber-900">{medico.nome}</span>
                            </div>
                            <select
                              className="input text-xs py-1 h-auto"
                              value={manualSelections[medico.id] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualSelections(prev => ({ ...prev, [medico.id]: val }));
                              }}
                            >
                              <option value="">-- Vincular manualmente --</option>
                              {producoesDisponiveis.map(p => (
                                <option key={p.id} value={p.id}>
                                  {p.nome}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Acompanhamento({ execucaoId, onNova }: { execucaoId: string; onNova: () => void }) {
  const { execucao } = useExecucaoRealtime(execucaoId);
  const concluido = execucao?.status === 'concluido';

  return (
    <section className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Execução em andamento</h1>
          {execucao?.competencia && (
            <p className="mt-0.5 text-sm text-cc-ink-2 tabular font-mono">{execucao.competencia}</p>
          )}
        </div>
        <button onClick={onNova} className="btn-ghost btn btn-sm">
          Nova execução
        </button>
      </div>
      <ProgressoExecucao execucaoId={execucaoId} />
      {concluido && <RelatorioGrupos execucaoId={execucaoId} />}
    </section>
  );
}
