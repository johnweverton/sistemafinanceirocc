'use client';
import { useState, useMemo, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { execucoesService, execucaoQueryKeys, type ExecucaoSelecaoPayload } from '@/services/execucoes';
import { empresasService, empresaQueryKeys } from '@/services/empresas';
import { ProgressoExecucao } from './ProgressoExecucao';
import { RelatorioGrupos } from './RelatorioGrupos';
import { useExecucaoRealtime } from '@/hooks/useExecucaoRealtime';
import { useToast } from '@/components/ui/Toast';
import { CampoCompetencia } from '@/components/ui/CampoCompetencia';

/** Mesmo critério usado em MedicoForm.tsx e no Engine (isPediatra) — checagem local, sem I/O. */
function isPediatraEspecialidade(especialidade: string | null | undefined): boolean {
  return especialidade?.toLowerCase().includes('pediat') ?? false;
}

/** Mesmo critério do Engine (isAngiologista) — checagem local, sem I/O (GATE 2026-08-07).
 *  Angiologista não tem lote principal: a produção dele vem de Cateter/Fístula/Angiografia. */
function isAngiologistaEspecialidade(especialidade: string | null | undefined): boolean {
  return especialidade?.toLowerCase().includes('angiolog') ?? false;
}

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// Nomes de mês por extenso (sem acento, casa com normalizeName) — usado tanto pelo auto-match do
// modo "Por competência" quanto pelo pré-preenchimento de Competência dos modos "Por médico"/"Por
// empresa" (Story de polimento UX, 2026-07-30: mesmo padrão, dois usos).
const MESES_NFD = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Tenta extrair uma competência (AAAA-MM) do nome de uma produção — ex.: "Guias 2026-06",
 * "06/2026" ou "Junho/2026". Usada só para PRÉ-PREENCHER o campo Competência nos modos "Por
 * médico"/"Por empresa" (nunca trava o campo: a detecção pode falhar em nomes irregulares, e o
 * operador sempre pode digitar por cima — mesmo espírito de nunca auto-disparar sozinho).
 */
function extrairCompetenciaDoNome(nome: string): string | null {
  const norm = normalizeName(nome);
  const iso = norm.match(/(\d{4})-(\d{2})/);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${iso[1]}-${iso[2]}`;
  const numMesAno = norm.match(/(\d{1,2})[/-](\d{4})/);
  if (numMesAno) {
    const [, mesStr, anoStr] = numMesAno;
    if (mesStr && anoStr && Number(mesStr) >= 1 && Number(mesStr) <= 12) {
      return `${anoStr}-${mesStr.padStart(2, '0')}`;
    }
  }
  const ano = norm.match(/\d{4}/);
  if (ano) {
    const mesIndex = MESES_NFD.findIndex((m) => norm.includes(m));
    if (mesIndex >= 0) return `${ano[0]}-${String(mesIndex + 1).padStart(2, '0')}`;
  }
  return null;
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
  // Rastreia o último valor de Competência que NÓS preenchemos automaticamente (a partir do nome
  // da Produção, Story de polimento UX 2026-07-30), para só reaplicar o auto-preenchimento
  // enquanto o operador não tiver digitado algo diferente por conta própria — nunca sobrescreve
  // uma edição manual.
  const ultimaCompetenciaAuto = useRef<string | null>(null);
  function preencherCompetenciaAuto(nomeProducao: string) {
    const detectada = extrairCompetenciaDoNome(nomeProducao);
    if (!detectada) return;
    setCompetencia((atual) => {
      if (atual !== '' && atual !== ultimaCompetenciaAuto.current) return atual;
      return detectada;
    });
    ultimaCompetenciaAuto.current = detectada;
  }
  // Filtro por tipo (modo "Por competência") — permite disparar só os VH, só os credenciados etc.
  const [filtroTipoMedico, setFiltroTipoMedico] = useState<FiltroTipoMedico>('todos');
  const [execucaoId, setExecucaoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Custom manual selections (modo "Por competência")
  const [manualSelections, setManualSelections] = useState<Record<string, string>>({});
  // Produção de consultas de pediatria — sempre manual, nunca auto-match (evita heurística
  // arriscada sobre nome de produção numa mudança que afeta valor cobrado).
  const [consultaSelections, setConsultaSelections] = useState<Record<string, string>>({});
  // Lotes separados de Outros Hospitais/Imobilizações — sempre manual, mesmo motivo do
  // consultaSelections acima: nunca auto-match numa seleção que afeta valor cobrado.
  const [outrosHospitaisSelections, setOutrosHospitaisSelections] = useState<Record<string, string>>({});
  const [imobilizacoesSelections, setImobilizacoesSelections] = useState<Record<string, string>>({});

  // Seleção do modo "Por médico"
  const [medicoId, setMedicoId] = useState('');
  const [producaoId, setProducaoId] = useState('');
  const [consultaProducaoId, setConsultaProducaoId] = useState('');
  const [outrosHospitaisProducaoId, setOutrosHospitaisProducaoId] = useState('');
  const [imobilizacoesProducaoId, setImobilizacoesProducaoId] = useState('');
  // Produção MENSAL do médico Angiologista (ex.: "JULHO - 2026") — os sub-lotes de Cateter/
  // Fístula/Angiografia/Carta de Rede vivem DENTRO dela no painel de origem, mas fin-producoes
  // não os expõe: precisa de uma busca separada em fin-lotes (devolutiva do desenvolvedor, GATE
  // 2026-08-13). Esta produção NUNCA vai no payload como producaoExternaId (Angiologista não tem
  // lote principal) — serve só pra alimentar a busca de lotes abaixo.
  const [angiologistaProducaoMensalId, setAngiologistaProducaoMensalId] = useState('');
  // Lotes de Cateter/Fístula/Angiografia (médico Angiologista, GATE 2026-08-07) — substituem o
  // seletor de "Produção" normal, que não existe pra essa especialidade (sem lote principal).
  // ARRAYS (achado 2026-08-13): a origem divide cada categoria em quinzenas (1Q/2Q) como
  // sub-lotes separados — o operador marca TODOS os que valem pra esta execução (checkboxes),
  // nunca um-ou-outro, senão a 2ª quinzena fica de fora da cobrança.
  const [cateterProducaoIds, setCateterProducaoIds] = useState<string[]>([]);
  const [fistulaProducaoIds, setFistulaProducaoIds] = useState<string[]>([]);
  const [angiografiaProducaoIds, setAngiografiaProducaoIds] = useState<string[]>([]);
  // Carta de Rede (GATE 2026-08-12) — sem regra de contagem fixa (depende do procedimento
  // realizado no mês), então o operador digita a quantidade de guias manualmente. O select de
  // produção aqui é só referência/auditoria (qual lote de origem gerou aquele número), NÃO
  // alimenta o cálculo — só `cartaRedeGuias` conta.
  const [cartaRedeProducaoId, setCartaRedeProducaoId] = useState('');
  const [cartaRedeGuias, setCartaRedeGuias] = useState('');

  // Seleção do modo "Por empresa" — empresa + produção de guias cardíacas de cada médico
  // vinculado, sempre manual (nunca auto-match).
  const [empresaId, setEmpresaId] = useState('');
  const [empresaProducaoSelecoes, setEmpresaProducaoSelecoes] = useState<Record<string, string>>({});

  const { data: apoio, isLoading: isApoioLoading } = useQuery({
    queryKey: execucaoQueryKeys.apoio(),
    queryFn: execucoesService.apoio,
  });

  // Sub-lotes (Cateter/Fístula/Angiografia/Carta de Rede do Angiologista; Consultas/demais sub-
  // lotes do Pediatra — achado 2026-08-21; Imobilizações — achado 2026-08-25) da produção mensal
  // selecionada — busca sob demanda (GATE 2026-08-13), só quando o operador escolheu a produção
  // mensal. Nunca faz parte de `apoio` (custaria uma chamada extra por médico/produção à toa).
  // Pediatra/fazImobilizacoes usam a MESMA produção escolhida no seletor "Produção" principal
  // (`producaoId`) — ao contrário do Angiologista, que não tem lote principal e por isso tem seu
  // próprio id dedicado (`angiologistaProducaoMensalId`) só pra alimentar esta busca. Calculado
  // sem esperar `validMedicos` (definido mais abaixo) pra não reordenar hooks — busca direto em
  // `apoio`.
  const medicoSelecionado = apoio?.medicos.find((m) => m.id === medicoId);
  const medicoSelecionadoEhPediatra = isPediatraEspecialidade(medicoSelecionado?.especialidade);
  const idParaBuscarLotes =
    angiologistaProducaoMensalId ||
    (medicoSelecionadoEhPediatra || medicoSelecionado?.fazImobilizacoes ? producaoId : '');
  const { data: lotesData, isLoading: isLotesLoading, isError: isLotesError, error: lotesError } = useQuery({
    queryKey: execucaoQueryKeys.lotes(idParaBuscarLotes),
    queryFn: () => execucoesService.lotes(idParaBuscarLotes),
    enabled: Boolean(idParaBuscarLotes),
    retry: false,
  });
  const lotesDaProducaoMensal = lotesData?.lotes ?? [];

  const { data: empresas, isLoading: isEmpresasLoading } = useQuery({
    queryKey: empresaQueryKeys.empresas(),
    queryFn: () => empresasService.listar(),
  });
  const empresasAtivas = (empresas ?? []).filter((e) => e.ativo);

  // Médicos com boleto ATIVO (emitido/pago) já nesta competência, em qualquer execução —
  // achado real (2026-08-04, coordenadora financeira): emitir individual e depois rodar o
  // mesmo mês em lote não detectava que alguns médicos já tinham boleto, arriscando duplicar.
  // Sem `staleTime`/cache longo de propósito — precisa refletir uma emissão feita há segundos.
  const { data: medicosComBoletoData } = useQuery({
    queryKey: execucaoQueryKeys.medicosComBoleto(competencia),
    queryFn: () => execucoesService.medicosComBoleto(competencia),
    enabled: /^\d{4}-\d{2}$/.test(competencia),
  });
  const medicosComBoletoAtivo = useMemo(
    () => new Set(medicosComBoletoData?.medicoIds ?? []),
    [medicosComBoletoData],
  );

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
    const jaEmitidos: any[] = [];
    const finalPayload: ExecucaoSelecaoPayload[] = [];

    const compValida = /^\d{4}-\d{2}$/.test(competencia);
    const split = compValida ? competencia.split('-') : ['', ''];
    const ano = split[0] || '';
    const mes = split[1] || '';
    const mesIndex = compValida ? parseInt(mes, 10) - 1 : -1;
    const mesNome = mesIndex >= 0 ? (MESES_NFD[mesIndex] || '') : '';

    for (const med of medicosParaCompetencia) {
      // Já tem boleto ativo (emitido/pago) nesta competência, de uma execução ANTERIOR — nunca
      // entra na lista de seleção (nem manual, nem auto-match), pra não arriscar duplicar.
      if (medicosComBoletoAtivo.has(med.id)) {
        jaEmitidos.push(med);
        continue;
      }

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
        // Produção de consultas é sempre escolha manual do operador (nunca auto-match) —
        // só entra no payload se o pediatra tiver uma selecionada.
        const consultaProdId = consultaSelections[med.id];
        const consultaProd = consultaProdId
          ? producoesDoMedico.find((p) => p.id === consultaProdId)
          : undefined;
        // Mesmo mecanismo acima para os lotes separados de Outros Hospitais/Imobilizações —
        // sempre manual, nunca auto-match (afeta valor cobrado).
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

    return { matched, unmatched, jaEmitidos, finalPayload };
  }, [
    medicosParaCompetencia,
    producoes,
    manualSelections,
    consultaSelections,
    outrosHospitaisSelections,
    imobilizacoesSelections,
    competencia,
    medicosComBoletoAtivo,
  ]);

  const disparar = useMutation({
    mutationFn: (vars: { competencia: string; selecoes: ExecucaoSelecaoPayload[]; empresaId?: string }) =>
      execucoesService.disparar(vars.competencia, vars.selecoes, vars.empresaId),
    onSuccess: ({ execucaoId }) => {
      setExecucaoId(execucaoId);
      setErro(null);
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.execucoes() });
      // Achado 2026-08-05: sem isso, um médico recém-emitido continuava elegível pra seleção
      // (manual ou em lote) na mesma sessão até um refetch natural — mesma classe de risco de
      // duplicidade que medicosComBoletoAtivo foi criado pra evitar (2026-08-04).
      void qc.invalidateQueries({ queryKey: execucaoQueryKeys.medicosComBoleto(competencia) });
      toast('Emissão iniciada. Acompanhe o progresso.', 'success');
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
  // Médico já tem boleto ativo (emitido/pago) nesta competência, de uma execução ANTERIOR —
  // mesma checagem do modo "Por competência" (achado real 2026-08-04), bloqueia disparo.
  const medicoJaTemBoleto = Boolean(medicoId) && medicosComBoletoAtivo.has(medicoId);
  const medicoSelecionadoAngiologista = isAngiologistaEspecialidade(
    validMedicos.find((m) => m.id === medicoId)?.especialidade,
  );
  // Angiologista não tem "Produção" (lote principal) pra exigir — em troca, exige pelo menos UM
  // dos 4 lotes próprios preenchido (Cateter/Fístula/Angiografia/Carta de Rede), senão não
  // haveria nada pra processar (GATE 2026-08-07, Carta de Rede GATE 2026-08-12).
  const producaoObrigatoriaOk = medicoSelecionadoAngiologista
    ? Boolean(cateterProducaoIds.length || fistulaProducaoIds.length || angiografiaProducaoIds.length || cartaRedeGuias !== '')
    : Boolean(producaoSelecionada);
  const canDispararMedico =
    Boolean(medicoId && competenciaValida) && producaoObrigatoriaOk && !medicoJaTemBoleto && !disparar.isPending;

  const medicosDaEmpresa = validMedicos.filter((m) => m.empresaGrupoId === empresaId);
  const empresaSelecoesPayload: ExecucaoSelecaoPayload[] = medicosDaEmpresa
    .map((m) => {
      const producoesDoMedico = producoes.filter((p) => p.clienteId === m.externalId);
      const prodId = empresaProducaoSelecoes[m.id];
      const prod = prodId ? producoesDoMedico.find((p) => p.id === prodId) : undefined;
      return prod ? { medicoId: m.id, producaoExternaId: prod.id, producaoNome: prod.nome } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s != null);
  const canDispararEmpresa =
    Boolean(empresaId) &&
    empresaSelecoesPayload.length > 0 &&
    empresaSelecoesPayload.length === medicosDaEmpresa.length &&
    competenciaValida &&
    !disparar.isPending;

  return (
    <section className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Nova emissão</h1>
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
                  <option value="">Selecione uma empresa…</option>
                  {empresasAtivas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-cc-muted">
                  Agrupa a produção de guias cardíacas (ou análoga) dos médicos vinculados a esta empresa num único boleto.
                </p>
              </div>

              <CampoCompetencia
                id="competencia-empresa"
                value={competencia}
                onChange={setCompetencia}
              />

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
                <p className="text-sm text-cc-muted">Selecione uma empresa para ver os médicos vinculados.</p>
              ) : medicosDaEmpresa.length === 0 ? (
                <p className="text-sm text-cc-muted">Nenhum médico vinculado a esta empresa (cadastro em Médicos → Empresa de agrupamento).</p>
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
                          onChange={(e) => {
                            const producaoId = e.target.value;
                            setEmpresaProducaoSelecoes((prev) => ({ ...prev, [m.id]: producaoId }));
                            const producao = producoesDoMedico.find((p) => p.id === producaoId);
                            if (producao) preencherCompetenciaAuto(producao.nome);
                          }}
                          aria-label={`Produção de guias cardíacas de ${m.nome}`}
                        >
                          <option value="">
                            {producoesDoMedico.length === 0 ? 'Sem produções na origem' : 'Selecione a produção…'}
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
                    setAngiologistaProducaoMensalId('');
                    setCateterProducaoIds([]);
                    setFistulaProducaoIds([]);
                    setAngiografiaProducaoIds([]);
                    setCartaRedeProducaoId('');
                    setCartaRedeGuias('');
                  }}
                  disabled={isApoioLoading}
                >
                  <option value="">Selecione um médico…</option>
                  {validMedicos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
                {medicoJaTemBoleto && (
                  <p role="alert" className="mt-1.5 text-xs text-cc-danger">
                    Este médico já tem boleto emitido para a competência {competencia || 'informada'}. Selecione outra competência ou outro médico.
                  </p>
                )}
              </div>

              {medicoSelecionadoAngiologista ? (
                <>
                  <div>
                    <label htmlFor="producao-mensal-angiologista-select" className="field-label mb-1.5">
                      Produção mensal
                    </label>
                    <select
                      id="producao-mensal-angiologista-select"
                      className="input"
                      value={angiologistaProducaoMensalId}
                      onChange={(e) => {
                        const novoId = e.target.value;
                        setAngiologistaProducaoMensalId(novoId);
                        // Sub-lotes de outra produção deixam de fazer sentido — evita enviar um
                        // loteId que pertence à produção mensal anterior.
                        setCateterProducaoIds([]);
                        setFistulaProducaoIds([]);
                        setAngiografiaProducaoIds([]);
                        setCartaRedeProducaoId('');
                        const producao = producoesDoMedicoSelecionado.find((p) => p.id === novoId);
                        if (producao) preencherCompetenciaAuto(producao.nome);
                      }}
                      disabled={!medicoId}
                    >
                      <option value="">
                        {medicoId ? 'Selecione a produção mensal…' : 'Selecione um médico primeiro'}
                      </option>
                      {producoesDoMedicoSelecionado.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-cc-muted">
                      Os lotes de Cateter/Fístula/Angiografia/Carta de Rede vivem dentro desta produção no painel de origem — selecione-a para listá-los abaixo.
                    </p>
                  </div>
                  {(
                    [
                      { label: 'Lote de Cateter', valores: cateterProducaoIds, set: setCateterProducaoIds, id: 'producao-cateter' },
                      { label: 'Lote de Fístula', valores: fistulaProducaoIds, set: setFistulaProducaoIds, id: 'producao-fistula' },
                      { label: 'Lote de Angiografia', valores: angiografiaProducaoIds, set: setAngiografiaProducaoIds, id: 'producao-angiografia' },
                    ] as const
                  ).map(({ label, valores, set, id }) => (
                    <div key={id}>
                      <span className="field-label mb-1.5 block">
                        {label}{' '}
                        <span className="font-normal normal-case text-cc-muted">
                          (opcional — marque mais de um se houver quinzenas separadas, ex.: 1Q e 2Q)
                        </span>
                      </span>
                      <div className="space-y-1.5">
                        {lotesDaProducaoMensal.map((l) => (
                          <label key={l.id} htmlFor={`${id}-${l.id}`} className="flex cursor-pointer items-center gap-2.5 text-sm">
                            <input
                              id={`${id}-${l.id}`}
                              type="checkbox"
                              className="h-4 w-4 rounded border-cc-hairline accent-cc-accent"
                              checked={valores.includes(l.id)}
                              onChange={(e) =>
                                set(e.target.checked ? [...valores, l.id] : valores.filter((v) => v !== l.id))
                              }
                              disabled={!angiologistaProducaoMensalId || isLotesLoading}
                            />
                            {l.nome}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {isLotesError && (
                    <p role="alert" className="alert-error">
                      Falha ao buscar os sub-lotes na origem:{' '}
                      {lotesError instanceof ApiClientError ? lotesError.message : String(lotesError)}
                    </p>
                  )}
                  {angiologistaProducaoMensalId && !isLotesLoading && !isLotesError && lotesDaProducaoMensal.length === 0 && (
                    <p className="text-xs text-cc-muted">
                      Nenhum sub-lote encontrado nesta produção na origem.
                    </p>
                  )}
                  <div>
                    <label htmlFor="carta-rede-guias-input" className="field-label mb-1.5">
                      Carta de Rede — guias{' '}
                      <span className="font-normal normal-case text-cc-muted">(manual, opcional)</span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        id="producao-carta-rede-select"
                        className="input"
                        value={cartaRedeProducaoId}
                        onChange={(e) => setCartaRedeProducaoId(e.target.value)}
                        disabled={!angiologistaProducaoMensalId || isLotesLoading}
                        aria-label="Lote de Carta de Rede (referência)"
                      >
                        <option value="">Sem produção de referência</option>
                        {lotesDaProducaoMensal.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.nome}
                          </option>
                        ))}
                      </select>
                      <input
                        id="carta-rede-guias-input"
                        type="number"
                        min={0}
                        step={1}
                        className="input w-28"
                        placeholder="Guias"
                        value={cartaRedeGuias}
                        onChange={(e) => setCartaRedeGuias(e.target.value)}
                        disabled={!medicoId}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="producao-select" className="field-label mb-1.5">
                    Produção
                  </label>
                  <select
                    id="producao-select"
                    className="input"
                    value={producaoId}
                    onChange={(e) => {
                      const novaProducaoId = e.target.value;
                      setProducaoId(novaProducaoId);
                      // Achado 2026-08-21: sub-lotes (e a lista de "Produção de consultas" que os
                      // exibe) são específicos da produção mensal selecionada — trocar de
                      // produção sem limpar deixava uma seleção de consulta "fantasma" da
                      // produção ANTERIOR ainda marcada no seletor.
                      setConsultaProducaoId('');
                      const producao = producoesDoMedicoSelecionado.find((p) => p.id === novaProducaoId);
                      if (producao) preencherCompetenciaAuto(producao.nome);
                    }}
                    disabled={!medicoId}
                  >
                    <option value="">
                      {medicoId ? 'Selecione a produção…' : 'Selecione um médico primeiro'}
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
              )}

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
                    disabled={Boolean(producaoId) && isLotesLoading}
                  >
                    <option value="">Sem componente de consultas</option>
                    {/* Sub-lotes da produção mensal selecionada (achado 2026-08-21) — a origem pode
                        dividir "JULHO - 2026" em sub-lotes de guias (1Q/2Q/PARECER/2,5KG) MAIS um
                        sub-lote de consultas (ex.: "HUMBERTO CONSULTAS DE JUNHO"). Escolher um
                        aqui muda o cálculo do guia principal também: os DEMAIS sub-lotes desta
                        produção passam a somar como guia (em vez do pacote completo), automático,
                        sem precisar marcar mais nada — ver onClick de "Processar médico" abaixo.
                        Vem ANTES da lista de produções (achado 2026-08-25, feedback do dono): é a
                        opção mais usada por quem tem sub-lote, não faz sentido rolar até o fim. */}
                    {lotesDaProducaoMensal.length > 0 && (
                      <optgroup label={`Sub-lotes de ${producaoSelecionada?.nome ?? 'produção selecionada'}`}>
                        {lotesDaProducaoMensal.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.nome}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {producoesDoMedicoSelecionado
                      .filter((p) => p.id !== producaoId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Se este pediatra tem um lote separado de consultas ambulatoriais, selecione aqui para somar ao valor de guias. Se a produção selecionada tiver sub-lotes (ex.: &ldquo;CONSULTAS DE JUNHO&rdquo;), escolher um deles aqui faz o restante dos sub-lotes virar guia principal automaticamente.
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
                    <option value="">Selecione o lote…</option>
                    {producoesDoMedicoSelecionado
                      .filter((p) => p.id !== producaoId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Este médico faz Outros Hospitais: produção SEPARADA da normal, com tabela de preço própria. Sem selecionar, essas guias NÃO são cobradas (o motor gera alerta em vez de chutar).
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
                    disabled={Boolean(producaoId) && isLotesLoading}
                  >
                    <option value="">Selecione o lote…</option>
                    {/* Sub-lotes da produção mensal selecionada (achado 2026-08-25) — mesmo mecanismo
                        do sub-lote de consultas acima: a origem pode dividir a produção mensal em
                        sub-lotes de guias MAIS um sub-lote de imobilizações (ex.: "1º QUINZENA
                        IMOBILIZAÇÕES"). Vem ANTES da lista de produções (feedback do dono,
                        2026-08-25): é a opção mais usada por quem tem sub-lote. Ao contrário do
                        sub-lote de consulta, escolher um aqui NÃO afeta o cálculo do lote principal
                        — Imobilizações já é classe separada, com tabela de preço própria. */}
                    {lotesDaProducaoMensal.length > 0 && (
                      <optgroup label={`Sub-lotes de ${producaoSelecionada?.nome ?? 'produção selecionada'}`}>
                        {lotesDaProducaoMensal.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.nome}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {producoesDoMedicoSelecionado
                      .filter((p) => p.id !== producaoId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                  <p className="mt-1.5 text-xs text-cc-muted">
                    Este médico faz Imobilizações: produção SEPARADA da normal, com tabela de preço própria. Sem selecionar, essas guias NÃO são cobradas (o motor gera alerta em vez de chutar).
                  </p>
                </div>
              )}

              <CampoCompetencia
                id="competencia-medico"
                value={competencia}
                onChange={setCompetencia}
              />

              {erro && <p role="alert" className="alert-error">{erro}</p>}

              <button
                onClick={() => {
                  if (!producaoObrigatoriaOk) return;
                  const consultaProd = producoesDoMedicoSelecionado.find((p) => p.id === consultaProducaoId);
                  // Achado 2026-08-21: se a escolha de Consultas é um SUB-LOTE (fin-lotes, não a
                  // lista flat de produções), o principal deixa de ser o pacote inteiro da
                  // produção mensal e passa a ser a soma dos OUTROS sub-lotes — automático, sem o
                  // operador precisar marcar mais nada (anti-dupla-contagem: ver migration 0052).
                  const consultaLote = lotesDaProducaoMensal.find((l) => l.id === consultaProducaoId);
                  const guiasLotesRestantes = consultaLote
                    ? lotesDaProducaoMensal.filter((l) => l.id !== consultaLote.id)
                    : [];
                  const outrosHospitaisProd = producoesDoMedicoSelecionado.find(
                    (p) => p.id === outrosHospitaisProducaoId,
                  );
                  // Achado 2026-08-25: mesmo mecanismo do consultaLote acima — a escolha de
                  // Imobilizações pode ser um SUB-LOTE (fin-lotes) em vez de produção flat. Ao
                  // contrário de Consultas, não precisa recalcular "guias restantes": Imobilizações
                  // já é classe separada da produção principal, o sub-lote não afeta o principal.
                  const imobilizacoesLote = lotesDaProducaoMensal.find((l) => l.id === imobilizacoesProducaoId);
                  const imobilizacoesProd = imobilizacoesLote
                    ? undefined
                    : producoesDoMedicoSelecionado.find((p) => p.id === imobilizacoesProducaoId);
                  // Sub-lotes vêm de fin-lotes (lotesDaProducaoMensal), não da lista flat de
                  // produções do médico — namespace de ids diferente (GATE 2026-08-13). Cada
                  // categoria pode ter mais de um lote marcado (1Q + 2Q, achado 2026-08-13).
                  const cateterProds = lotesDaProducaoMensal.filter((l) => cateterProducaoIds.includes(l.id));
                  const fistulaProds = lotesDaProducaoMensal.filter((l) => fistulaProducaoIds.includes(l.id));
                  const angiografiaProds = lotesDaProducaoMensal.filter((l) => angiografiaProducaoIds.includes(l.id));
                  const cartaRedeProd = lotesDaProducaoMensal.find((l) => l.id === cartaRedeProducaoId);
                  disparar.mutate({
                    competencia,
                    selecoes: [
                      {
                        medicoId,
                        // Angiologista não tem lote principal (GATE 2026-08-07) — vai null.
                        // Pediatra com sub-lote de consulta escolhido (achado 2026-08-21) também
                        // vai null — o principal vem de producaoGuiasLoteExternaIds abaixo.
                        producaoExternaId:
                          medicoSelecionadoAngiologista || consultaLote ? null : (producaoSelecionada?.id ?? null),
                        producaoNome:
                          medicoSelecionadoAngiologista || consultaLote ? null : (producaoSelecionada?.nome ?? null),
                        ...(consultaLote
                          ? {
                              producaoConsultasLoteExternaIds: [consultaLote.id],
                              producaoConsultasLoteNomes: [consultaLote.nome],
                              producaoGuiasLoteExternaIds: guiasLotesRestantes.map((l) => l.id),
                              producaoGuiasLoteNomes: guiasLotesRestantes.map((l) => l.nome),
                            }
                          : consultaProd
                            ? { producaoConsultasExternaId: consultaProd.id, producaoConsultasNome: consultaProd.nome }
                            : {}),
                        ...(outrosHospitaisProd
                          ? {
                              producaoOutrosHospitaisExternaId: outrosHospitaisProd.id,
                              producaoOutrosHospitaisNome: outrosHospitaisProd.nome,
                            }
                          : {}),
                        ...(imobilizacoesLote
                          ? {
                              producaoImobilizacoesLoteExternaId: imobilizacoesLote.id,
                              producaoImobilizacoesLoteNome: imobilizacoesLote.nome,
                            }
                          : imobilizacoesProd
                            ? {
                                producaoImobilizacoesExternaId: imobilizacoesProd.id,
                                producaoImobilizacoesNome: imobilizacoesProd.nome,
                              }
                            : {}),
                        ...(cateterProds.length
                          ? {
                              producaoCateterExternaIds: cateterProds.map((l) => l.id),
                              producaoCateterNomes: cateterProds.map((l) => l.nome),
                            }
                          : {}),
                        ...(fistulaProds.length
                          ? {
                              producaoFistulaExternaIds: fistulaProds.map((l) => l.id),
                              producaoFistulaNomes: fistulaProds.map((l) => l.nome),
                            }
                          : {}),
                        ...(angiografiaProds.length
                          ? {
                              producaoAngiografiaExternaIds: angiografiaProds.map((l) => l.id),
                              producaoAngiografiaNomes: angiografiaProds.map((l) => l.nome),
                            }
                          : {}),
                        ...(cartaRedeProd
                          ? {
                              producaoCartaRedeExternaId: cartaRedeProd.id,
                              producaoCartaRedeNome: cartaRedeProd.nome,
                            }
                          : {}),
                        ...(cartaRedeGuias !== '' ? { cartaRedeGuias: Number(cartaRedeGuias) } : {}),
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

                <CampoCompetencia
                  id="competencia"
                  name="competencia"
                  value={competencia}
                  onChange={setCompetencia}
                />

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
              <div className="card p-4 border-cc-warning/25 bg-cc-warning-soft">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-cc-warning">
                  <AlertTriangleIcon className="shrink-0" />
                  Fora da Emissão ({invalidMedicos.length})
                </h3>
                <p className="mb-3 text-xs text-cc-ink-2">
                  Completar cadastro ou vínculo destes médicos para poder processá-los.
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {invalidMedicos.map(m => (
                    <div key={m.id} className="flex items-center justify-between rounded bg-cc-surface/60 p-1.5 text-xs text-cc-ink">
                      <span className="truncate mr-2">{m.nome}</span>
                      <span className="shrink-0 text-cc-muted">
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
                    <h3 className="mb-2 flex items-center gap-1.5 font-medium text-cc-ink">
                      <CheckCircleIcon className="shrink-0 text-cc-success" />
                      Prontos para processar ({selecoesInfo.matched.length})
                    </h3>
                    {selecoesInfo.matched.length === 0 ? (
                      <p className="text-sm text-cc-muted">Nenhum médico pareado para esta competência.</p>
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
                                    className="p-1 text-cc-muted hover:text-cc-danger"
                                    title="Remover desta emissão"
                                    aria-label={`Remover ${medico.nome} desta emissão`}
                                  >
                                    &times;
                                  </button>
                                </div>
                              </div>
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
                              {/* Lote separado de Outros Hospitais — sempre manual (nunca auto-match, afeta
                                  valor cobrado). Sem lote selecionado, o motor gera alerta e NÃO cobra a
                                  classe (nunca reaproveita a produção principal). */}
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

                  {selecoesInfo.jaEmitidos.length > 0 && (
                    <div className="pt-4 border-t border-cc-border">
                      <h3 className="mb-2 flex items-center gap-1.5 font-medium text-cc-ink-2">
                        <CheckCircleIcon className="shrink-0 text-cc-muted" />
                        Já emitido nesta competência ({selecoesInfo.jaEmitidos.length})
                      </h3>
                      <p className="text-xs text-cc-muted mb-3">
                        Estes médicos já têm boleto emitido/pago para {competencia} (de uma execução anterior) e foram excluídos da seleção.
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {selecoesInfo.jaEmitidos.map((medico: any) => (
                          <div key={medico.id} className="rounded bg-cc-surface-2/60 p-1.5 text-xs text-cc-ink-2">
                            {medico.nome}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selecoesInfo.unmatched.length > 0 && (
                    <div className="pt-4 border-t border-cc-border">
                      <h3 className="mb-2 flex items-center gap-1.5 font-medium text-cc-warning">
                        <AlertTriangleIcon className="shrink-0" />
                        Vínculo manual pendente ({selecoesInfo.unmatched.length})
                      </h3>
                      <p className="text-xs text-cc-muted mb-3">Estes médicos possuem vínculo com a origem, mas nenhuma produção correspondente foi auto-identificada.</p>
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                        {selecoesInfo.unmatched.map(({ medico, producoesDisponiveis }) => (
                          <div key={medico.id} className="flex flex-col gap-2 rounded border border-cc-warning/25 bg-cc-warning-soft p-2">
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-sm text-cc-ink">{medico.nome}</span>
                            </div>
                            <select
                              className="input text-xs py-1 h-auto"
                              value={manualSelections[medico.id] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setManualSelections(prev => ({ ...prev, [medico.id]: val }));
                              }}
                            >
                              <option value="">Vincular manualmente…</option>
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
          <h1 className="page-title">Emissão em andamento</h1>
          {execucao?.competencia && (
            <p className="mt-0.5 text-sm text-cc-ink-2 tabular font-mono">{execucao.competencia}</p>
          )}
        </div>
        <button onClick={onNova} className="btn-ghost btn btn-sm">
          Nova emissão
        </button>
      </div>
      <ProgressoExecucao execucaoId={execucaoId} />
      {concluido && <RelatorioGrupos execucaoId={execucaoId} />}
    </section>
  );
}

/** Ícones SVG inline (mesmo padrão de components/layout/Sidebar.tsx) — substituem os emojis
 * literais que soavam genéricos/decorativos (polimento UX, 2026-07-30). */
function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function AlertTriangleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
