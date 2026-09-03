'use client';
import { useState, useMemo, useRef } from 'react';
import { useMutation, useQueryClient, useQuery, useQueries } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import {
  execucoesService,
  execucaoQueryKeys,
  type ExecucaoSelecaoPayload,
  type GuiasManuaisLinha,
  type GuiasManuaisPreview,
} from '@/services/execucoes';
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

/** Classe detectada pelo NOME do sub-lote (achado 2026-09-03, feedback do dono): médico VH que
 *  faz Imobilizações tem a produção mensal inteira dividida em sub-lotes por dia/período, cada
 *  um já nomeado com a classe ("CIRURGIAS - 05/08", "IMOBILIZAÇÕES 11/08 AO 12/08", ...). `null`
 *  quando o nome não bate com nenhum padrão (ou bate com os dois) — nesse caso o sub-lote fica
 *  sem classe automática e precisa de decisão manual (nunca chuta valor). */
type ClasseSubLoteImobilizacoes = 'cirurgia' | 'imobilizacao';
function classificarSubLoteImobilizacoes(nome: string): ClasseSubLoteImobilizacoes | null {
  const norm = normalizeName(nome);
  const cirurgia = /cirurgi/.test(norm);
  const imobilizacao = /imobiliz/.test(norm);
  if (cirurgia && !imobilizacao) return 'cirurgia';
  if (imobilizacao && !cirurgia) return 'imobilizacao';
  return null;
}

/** Mesma ideia de classificarSubLoteImobilizacoes, mas pro sub-lote de Consultas do Pediatra
 *  (achado 2026-09-03, feedback do dono) — só 1 palavra positiva ("CONSULTA"), sem ambiguidade:
 *  o que não bate vira guia principal por padrão (mesmo mecanismo já usado desde o achado
 *  2026-08-21, só que agora automático em vez de exigir 1 clique manual por sub-lote). */
function ehSubLoteConsultaPediatra(nome: string): boolean {
  return /consulta/.test(normalizeName(nome));
}

/** Classificação por nome dos sub-lotes do Angiologista (achado 2026-09-03, feedback do dono) —
 *  Cateter/Fístula/Carta de Rede usam palavra literal; Angiografia usa "PACOTE" (confirmado pelo
 *  dono — a origem não nomeia esse sub-lote com a palavra "Angiografia", ver
 *  docs/integracao/solicitacao-sublotes-angiologista.md). `null` quando nada bate ou mais de uma
 *  palavra bate — precisa de decisão manual (a distinção 1x1 vs 3x1 afeta valor cobrado). */
type ClasseSubLoteAngiologista = 'cateter' | 'fistula' | 'angiografia' | 'cartaRede';
function classificarSubLoteAngiologista(nome: string): ClasseSubLoteAngiologista | null {
  const norm = normalizeName(nome);
  const cateter = /cateter/.test(norm);
  const fistula = /fistula/.test(norm);
  const cartaRede = /carta.*rede/.test(norm);
  const angiografia = /pacote/.test(norm);
  const quantasBateram = [cateter, fistula, cartaRede, angiografia].filter(Boolean).length;
  if (quantasBateram !== 1) return null;
  if (cateter) return 'cateter';
  if (fistula) return 'fistula';
  if (cartaRede) return 'cartaRede';
  return 'angiografia';
}

/** Tipo mínimo de sub-lote usado pelos classificadores em lote abaixo — evita depender do tipo
 *  exato devolvido por `execucoesService.lotes` neste arquivo utilitário. */
type SubLoteMinimo = { id: string; nome: string };

/** Versão pura (sem hook) de classificacaoImobilizacoes — reusada tanto pelo modo "Por médico"
 *  (com override manual) quanto pelo modo "Por competência" (achado 2026-09-03: emissão em lote
 *  precisa da MESMA classificação automática, sem ela todo médico VH/Imobilizações saía com 0
 *  guias no disparo em massa). Sem overrides no modo em lote — são MUITOS médicos pra oferecer
 *  correção individual por sub-lote ali; um sub-lote não reconhecido manda o médico pro grupo
 *  "Requer atenção manual", que aponta pro modo "Por médico" pra resolver.
 */
function classificarLotesImobilizacoes<T extends SubLoteMinimo>(
  lotes: T[],
  overrides: Record<string, ClasseSubLoteImobilizacoes> = {},
): { cirurgia: T[]; imobilizacao: T[]; naoClassificados: T[] } {
  const cirurgia: T[] = [];
  const imobilizacao: T[] = [];
  const naoClassificados: T[] = [];
  for (const l of lotes) {
    const classe = overrides[l.id] ?? classificarSubLoteImobilizacoes(l.nome);
    if (classe === 'cirurgia') cirurgia.push(l);
    else if (classe === 'imobilizacao') imobilizacao.push(l);
    else naoClassificados.push(l);
  }
  return { cirurgia, imobilizacao, naoClassificados };
}

/** Versão pura (sem hook) de classificacaoAngiologista — mesmo motivo de classificarLotesImobilizacoes acima. */
function classificarLotesAngiologista<T extends SubLoteMinimo>(
  lotes: T[],
  overrides: Record<string, ClasseSubLoteAngiologista> = {},
): { cateter: T[]; fistula: T[]; angiografia: T[]; cartaRede: T[]; naoClassificados: T[] } {
  const cateter: T[] = [];
  const fistula: T[] = [];
  const angiografia: T[] = [];
  const cartaRede: T[] = [];
  const naoClassificados: T[] = [];
  for (const l of lotes) {
    const classe = overrides[l.id] ?? classificarSubLoteAngiologista(l.nome);
    if (classe === 'cateter') cateter.push(l);
    else if (classe === 'fistula') fistula.push(l);
    else if (classe === 'angiografia') angiografia.push(l);
    else if (classe === 'cartaRede') cartaRede.push(l);
    else naoClassificados.push(l);
  }
  return { cateter, fistula, angiografia, cartaRede, naoClassificados };
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
  // Carta de Rede do Angiologista no modo em lote (achado 2026-09-03) — sem regra de contagem
  // fixa (mesmo motivo do modo "Por médico"), então continua manual mesmo com a classificação
  // automática de Cateter/Fístula/Angiografia por nome. Opcional: sem preencher, o motor só gera
  // o alerta informativo de Carta de Rede — os outros 3 lotes cobram normalmente.
  const [cartaRedeGuiasSelections, setCartaRedeGuiasSelections] = useState<Record<string, string>>({});

  // Planilha de guias CONFERIDAS MANUALMENTE (migration 0058) — modo "Por competência". Dois
  // estados de propósito: `guiasManuaisPreview` é o que a planilha diz (ainda NÃO afeta o
  // disparo), `guiasManuaisAplicadas` é o que o operador confirmou depois de conferir. Enquanto
  // ele não clica em aplicar, nada muda no valor cobrado.
  // Os dois guardam a competência em que foram lidos: trocar a competência invalida a planilha
  // (as linhas foram validadas contra AQUELE mês) — em vez de um efeito que limpa o estado,
  // comparamos na hora de usar, que é impossível de esquecer.
  const [guiasManuaisPreview, setGuiasManuaisPreview] = useState<
    { competencia: string; arquivoNome: string; preview: GuiasManuaisPreview } | null
  >(null);
  const [guiasManuaisAplicadas, setGuiasManuaisAplicadas] = useState<
    { competencia: string; arquivoNome: string; linhas: GuiasManuaisLinha[] } | null
  >(null);
  const [guiasManuaisErro, setGuiasManuaisErro] = useState<string | null>(null);
  const guiasManuaisInputRef = useRef<HTMLInputElement>(null);

  // Seleção do modo "Por médico"
  const [medicoId, setMedicoId] = useState('');
  const [producaoId, setProducaoId] = useState('');
  const [consultaProducaoId, setConsultaProducaoId] = useState('');
  const [outrosHospitaisProducaoId, setOutrosHospitaisProducaoId] = useState('');
  const [imobilizacoesProducaoId, setImobilizacoesProducaoId] = useState('');
  // Correção manual de classificação (achado 2026-09-03) — só usada para sub-lotes cujo NOME não
  // bateu com nenhum padrão automático (nem "CIRURGIA*" nem "IMOBILIZ*"). Chave = id do sub-lote
  // (fin-lotes), valor = classe escolhida à mão. Vazio no caso comum (tudo classificado sozinho).
  const [subLoteImobilizacoesOverride, setSubLoteImobilizacoesOverride] = useState<
    Record<string, ClasseSubLoteImobilizacoes>
  >({});
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
  // Achado 2026-09-03: os 3 checkboxes manuais (1 por categoria, cada um listando TODOS os
  // sub-lotes) viraram classificação automática por nome (ver classificarSubLoteAngiologista) —
  // `subLoteAngiologistaOverride` só entra pros sub-lotes cujo nome não bateu com nenhuma
  // categoria (nem Cateter, nem Fístula, nem Carta de Rede, nem "PACOTE" de Angiografia).
  const [subLoteAngiologistaOverride, setSubLoteAngiologistaOverride] = useState<
    Record<string, ClasseSubLoteAngiologista>
  >({});
  // Carta de Rede (GATE 2026-08-12) — sem regra de contagem fixa (depende do procedimento
  // realizado no mês), então o operador digita a quantidade de guias manualmente. O sub-lote de
  // referência (qual lote de origem gerou aquele número) agora vem da classificação automática
  // acima — NÃO alimenta o cálculo, só `cartaRedeGuias` conta.
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

  // Auto-classificação do sub-lote de Consultas do Pediatra por NOME (achado 2026-09-03) —
  // generaliza o mecanismo manual do achado 2026-08-21 (escolher 1 sub-lote como consulta, resto
  // vira guia principal): agora QUALQUER sub-lote cujo nome contenha "CONSULTA" entra
  // automaticamente nessa classe, e podem ser VÁRIOS (antes só dava pra marcar 1 no dropdown).
  // Sem ambiguidade possível (1 palavra positiva só) — o que não bate simplesmente vira guia
  // principal, sem precisar de tela de correção manual.
  const lotesConsultaAutoDetectados = useMemo(
    () => lotesDaProducaoMensal.filter((l) => ehSubLoteConsultaPediatra(l.nome)),
    [lotesDaProducaoMensal],
  );
  const temSubLotesConsultaAutoDetectados = lotesConsultaAutoDetectados.length > 0;

  // Auto-classificação de sub-lotes de Imobilizações por NOME (achado 2026-09-03) — só entra em
  // jogo quando existe pelo menos 1 sub-lote nomeado "CIRURGIA*": esse é o sinal de que a origem
  // divide a produção mensal INTEIRA deste médico em sub-lotes (padrão VH), então a "Produção"
  // completa não pode ser usada como guia principal (contaria os itens de Imobilizações 2x) — o
  // guia principal passa a ser a soma dos sub-lotes de Cirurgia, mesmo mecanismo de
  // producaoGuiasLoteExternaIds já usado pro sub-lote de Consultas do Pediatra. Quando NÃO há
  // sub-lote de Cirurgia (padrão antigo: 1 produção flat + no máximo 1 sub-lote de Imobilizações
  // à parte), nada muda — mantém o fluxo manual de sempre (ver bloco "Lote de Imobilizações"
  // abaixo). Exclui os sub-lotes já classificados como Consultas (manual ou automático) do
  // universo classificado, pro raro caso de um médico ser Pediatra E fazImobilizacoes ao mesmo
  // tempo.
  const lotesElegiveisImobilizacoes = useMemo(
    () =>
      lotesDaProducaoMensal.filter(
        (l) => l.id !== consultaProducaoId && !lotesConsultaAutoDetectados.some((c) => c.id === l.id),
      ),
    [lotesDaProducaoMensal, consultaProducaoId, lotesConsultaAutoDetectados],
  );
  const classificacaoImobilizacoes = useMemo(
    () => classificarLotesImobilizacoes(lotesElegiveisImobilizacoes, subLoteImobilizacoesOverride),
    [lotesElegiveisImobilizacoes, subLoteImobilizacoesOverride],
  );
  const temSubLotesCirurgiaImobilizacoes =
    Boolean(medicoSelecionado?.fazImobilizacoes) && classificacaoImobilizacoes.cirurgia.length > 0;

  // Auto-classificação dos sub-lotes do Angiologista por NOME (achado 2026-09-03) — substitui os
  // 3 checkboxes manuais (Cateter/Fístula/Angiografia), cada um listando TODOS os sub-lotes e
  // exigindo que o operador soubesse identificar de olho qual pertencia a qual categoria.
  const classificacaoAngiologista = useMemo(
    () => classificarLotesAngiologista(lotesDaProducaoMensal, subLoteAngiologistaOverride),
    [lotesDaProducaoMensal, subLoteAngiologistaOverride],
  );

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

  // FASE 1 (modo "Por competência"): casamento médico↔produção mensal por nome/data — não
  // depende de sub-lotes, só de `apoio` + vínculo manual. Extraído do cálculo final (achado
  // 2026-09-03) porque agora precisamos SABER o match ANTES de decidir quais médicos precisam de
  // busca de sub-lotes (Angiologista/Pediatra/Imobilizações) — sem essa busca, TODO médico
  // Angiologista saía com 0 guias no disparo em massa (nenhum lote de Cateter/Fístula/Angiografia
  // era buscado), e VH/Imobilizações e Pediatra-com-sub-lote de Consulta ficavam com a produção
  // completa errada.
  const matchResultado = useMemo(() => {
    const matched: Array<{ medico: any; producao: any; guiasManuais?: GuiasManuaisLinha }> = [];
    const unmatched: Array<{ medico: any; producoesDisponiveis: any[] }> = [];
    const jaEmitidos: any[] = [];

    const manuaisPorMedico = new Map<string, GuiasManuaisLinha>(
      guiasManuaisAplicadas && guiasManuaisAplicadas.competencia === competencia
        ? guiasManuaisAplicadas.linhas.map((l) => [l.medicoId, l])
        : [],
    );

    const compValida = /^\d{4}-\d{2}$/.test(competencia);
    const split = compValida ? competencia.split('-') : ['', ''];
    const ano = split[0] || '';
    const mes = split[1] || '';
    const mesIndex = compValida ? parseInt(mes, 10) - 1 : -1;
    const mesNome = mesIndex >= 0 ? (MESES_NFD[mesIndex] || '') : '';

    for (const med of medicosParaCompetencia) {
      if (medicosComBoletoAtivo.has(med.id)) {
        jaEmitidos.push(med);
        continue;
      }

      const producoesDoMedico = producoes.filter((p) => p.clienteId === med.externalId);
      const manualProdId = manualSelections[med.id];

      if (manualProdId === 'IGNORE') {
        unmatched.push({ medico: med, producoesDisponiveis: producoesDoMedico });
        continue;
      }

      let match = producoesDoMedico.find((p) => p.id === manualProdId);

      if (!match && compValida) {
        match = producoesDoMedico.find((p) => {
          const norm = normalizeName(p.nome);
          const hasData = norm.includes(`${ano}-${mes}`) || norm.includes(`${mes}/${ano}`) || norm.includes(`${mes}-${ano}`);
          const hasExtenso = norm.includes(mesNome) && norm.includes(ano);
          return hasData || hasExtenso;
        });
      }

      if (match) {
        matched.push({ medico: med, producao: match, guiasManuais: manuaisPorMedico.get(med.id) });
      } else {
        unmatched.push({ medico: med, producoesDisponiveis: producoesDoMedico });
      }
    }

    return { matched, unmatched, jaEmitidos, manuaisPorMedico };
  }, [medicosParaCompetencia, producoes, manualSelections, competencia, medicosComBoletoAtivo, guiasManuaisAplicadas]);

  // FASE 2: quais médicos casados precisam de sub-lotes (Angiologista/Pediatra/Imobilizações) —
  // mesmo critério do modo "Por médico" (`idParaBuscarLotes`) — e busca todos em paralelo. Sem
  // sub-lotes na resposta (médico "normal", sem nenhum desses 3 casos), a lista fica vazia e
  // `useQueries` não faz nenhuma chamada extra.
  const medicosNecessitandoLotesBulk = useMemo(
    () =>
      matchResultado.matched
        .filter(
          ({ medico }) =>
            isAngiologistaEspecialidade(medico.especialidade) ||
            isPediatraEspecialidade(medico.especialidade) ||
            medico.fazImobilizacoes,
        )
        .map(({ medico, producao }) => ({ medicoId: medico.id as string, producaoId: producao.id as string })),
    [matchResultado],
  );
  const queriesLotesBulk = useQueries({
    queries: medicosNecessitandoLotesBulk.map(({ producaoId }) => ({
      queryKey: execucaoQueryKeys.lotes(producaoId),
      queryFn: () => execucoesService.lotes(producaoId),
      enabled: Boolean(producaoId),
      retry: false,
      // Sub-lotes não mudam durante a sessão de disparo — evita refazer 1 chamada por médico a
      // cada digitação no filtro/competência.
      staleTime: 5 * 60_000,
    })),
  });
  const lotesPorMedicoIdBulk = useMemo(() => {
    const mapa = new Map<string, { lotes: { id: string; nome: string }[]; isLoading: boolean }>();
    medicosNecessitandoLotesBulk.forEach(({ medicoId }, i) => {
      const q = queriesLotesBulk[i];
      mapa.set(medicoId, { lotes: q?.data?.lotes ?? [], isLoading: Boolean(q?.isLoading) });
    });
    return mapa;
  }, [medicosNecessitandoLotesBulk, queriesLotesBulk]);
  const algumLoteBulkCarregando = queriesLotesBulk.some((q) => q.isLoading);

  // FASE 3: combina o match (fase 1) com a classificação automática de sub-lotes (fase 2, mesmos
  // classificadores puros do modo "Por médico") e as seleções manuais (planilha, Outros
  // Hospitais, fallback antigo de Consultas/Imobilizações, Carta de Rede) pra montar o payload
  // final. Médico que precisa de sub-lotes mas cuja busca ainda não voltou fica de fora do
  // payload até resolver — evita disparar uma competência de 60+ médicos com dado incompleto no
  // meio do carregamento.
  const selecoesInfo = useMemo(() => {
    const finalPayload: ExecucaoSelecaoPayload[] = [];
    const matched: Array<{
      medico: any;
      producao: any;
      guiasManuais?: GuiasManuaisLinha;
      angiologista: boolean;
      usaConsultaAuto: boolean;
      temCirurgiaVh: boolean;
    }> = [];
    const precisaAtencaoManual: Array<{ medico: any; motivo: string }> = [];
    const manuaisUsados = new Set<string>();

    for (const { medico: med, producao: match, guiasManuais } of matchResultado.matched) {
      if (guiasManuais) manuaisUsados.add(med.id);

      const angiologista = isAngiologistaEspecialidade(med.especialidade);
      const pediatra = isPediatraEspecialidade(med.especialidade);
      const producoesDoMedico = producoes.filter((p) => p.clienteId === med.externalId);
      const precisaDeLotes = angiologista || pediatra || med.fazImobilizacoes;
      const infoLote = lotesPorMedicoIdBulk.get(med.id);

      if (precisaDeLotes && (!infoLote || infoLote.isLoading)) {
        continue; // ainda carregando os sub-lotes deste médico — fica de fora por enquanto
      }
      const lotesDoMedico = infoLote?.lotes ?? [];

      if (angiologista) {
        const c = classificarLotesAngiologista(lotesDoMedico);
        if (c.naoClassificados.length > 0) {
          precisaAtencaoManual.push({
            medico: med,
            motivo: `${c.naoClassificados.length} sub-lote(s) com nome não reconhecido (Cateter/Fístula/Angiografia/Carta de Rede) — processar individualmente pelo modo "Por médico" para revisar.`,
          });
          continue;
        }
        if (!c.cateter.length && !c.fistula.length && !c.angiografia.length && !c.cartaRede.length) {
          precisaAtencaoManual.push({
            medico: med,
            motivo: 'Médico Angiologista sem nenhum sub-lote de Cateter/Fístula/Angiografia/Carta de Rede identificado na produção mensal.',
          });
          continue;
        }
        matched.push({ medico: med, producao: match, guiasManuais, angiologista: true, usaConsultaAuto: false, temCirurgiaVh: false });
        const cartaRedeGuiasStr = cartaRedeGuiasSelections[med.id];
        finalPayload.push({
          medicoId: med.id,
          producaoExternaId: null,
          producaoNome: null,
          ...(c.cateter.length
            ? { producaoCateterExternaIds: c.cateter.map((l) => l.id), producaoCateterNomes: c.cateter.map((l) => l.nome) }
            : {}),
          ...(c.fistula.length
            ? { producaoFistulaExternaIds: c.fistula.map((l) => l.id), producaoFistulaNomes: c.fistula.map((l) => l.nome) }
            : {}),
          ...(c.angiografia.length
            ? {
                producaoAngiografiaExternaIds: c.angiografia.map((l) => l.id),
                producaoAngiografiaNomes: c.angiografia.map((l) => l.nome),
              }
            : {}),
          ...(c.cartaRede[0]
            ? { producaoCartaRedeExternaId: c.cartaRede[0].id, producaoCartaRedeNome: c.cartaRede[0].nome }
            : {}),
          ...(cartaRedeGuiasStr ? { cartaRedeGuias: Number(cartaRedeGuiasStr) } : {}),
        });
        continue;
      }

      // Pediatra/fazImobilizacoes: mesma classificação automática de sub-lotes do modo "Por
      // médico" (Consultas por "CONSULTA" no nome; Cirurgia/Imobilizações do padrão VH).
      const lotesConsulta = pediatra ? lotesDoMedico.filter((l) => ehSubLoteConsultaPediatra(l.nome)) : [];
      const usaConsultaAuto = lotesConsulta.length > 0;
      const cImob = med.fazImobilizacoes
        ? classificarLotesImobilizacoes(lotesDoMedico.filter((l) => !lotesConsulta.some((c) => c.id === l.id)))
        : { cirurgia: [] as typeof lotesDoMedico, imobilizacao: [] as typeof lotesDoMedico, naoClassificados: [] as typeof lotesDoMedico };
      const temCirurgiaVh = Boolean(med.fazImobilizacoes) && cImob.cirurgia.length > 0;

      if (temCirurgiaVh && cImob.naoClassificados.length > 0) {
        precisaAtencaoManual.push({
          medico: med,
          motivo: `${cImob.naoClassificados.length} sub-lote(s) de Imobilizações com nome não reconhecido — processar individualmente pelo modo "Por médico" para revisar.`,
        });
        continue;
      }

      matched.push({ medico: med, producao: match, guiasManuais, angiologista: false, usaConsultaAuto, temCirurgiaVh });

      const guiasRestantes = temCirurgiaVh
        ? cImob.cirurgia
        : usaConsultaAuto
          ? lotesDoMedico.filter((l) => !lotesConsulta.some((c) => c.id === l.id))
          : [];

      // Fallback antigo (produção flat, não sub-lote) — só usado quando a auto-classificação
      // acima não se aplica (sem sub-lote de Consulta/Cirurgia detectado nesta produção).
      const consultaProdId = consultaSelections[med.id];
      const consultaProdManual =
        !usaConsultaAuto && consultaProdId ? producoesDoMedico.find((p) => p.id === consultaProdId) : undefined;
      const outrosHospitaisProdId = outrosHospitaisSelections[med.id];
      const outrosHospitaisProd = outrosHospitaisProdId
        ? producoesDoMedico.find((p) => p.id === outrosHospitaisProdId)
        : undefined;
      const imobilizacoesProdId = imobilizacoesSelections[med.id];
      const imobilizacoesProdManual =
        !temCirurgiaVh && imobilizacoesProdId ? producoesDoMedico.find((p) => p.id === imobilizacoesProdId) : undefined;

      finalPayload.push({
        medicoId: med.id,
        producaoExternaId: temCirurgiaVh || usaConsultaAuto ? null : match.id,
        producaoNome: temCirurgiaVh || usaConsultaAuto ? null : match.nome,
        ...(usaConsultaAuto
          ? {
              producaoConsultasLoteExternaIds: lotesConsulta.map((l) => l.id),
              producaoConsultasLoteNomes: lotesConsulta.map((l) => l.nome),
            }
          : consultaProdManual
            ? { producaoConsultasExternaId: consultaProdManual.id, producaoConsultasNome: consultaProdManual.nome }
            : {}),
        ...(temCirurgiaVh || usaConsultaAuto
          ? {
              producaoGuiasLoteExternaIds: guiasRestantes.map((l) => l.id),
              producaoGuiasLoteNomes: guiasRestantes.map((l) => l.nome),
            }
          : {}),
        ...(outrosHospitaisProd
          ? {
              producaoOutrosHospitaisExternaId: outrosHospitaisProd.id,
              producaoOutrosHospitaisNome: outrosHospitaisProd.nome,
            }
          : {}),
        ...(temCirurgiaVh
          ? {
              producaoImobilizacoesLoteExternaIds: cImob.imobilizacao.map((l) => l.id),
              producaoImobilizacoesLoteNomes: cImob.imobilizacao.map((l) => l.nome),
            }
          : imobilizacoesProdManual
            ? {
                producaoImobilizacoesExternaId: imobilizacoesProdManual.id,
                producaoImobilizacoesNome: imobilizacoesProdManual.nome,
              }
            : {}),
        // Migration 0058: substitui a contagem automática SÓ deste médico. O motor ignora a
        // contagem automática das guias, mas o resto do pipeline (consultas, lotes secundários)
        // continua igual.
        ...(guiasManuais
          ? { guiasManuaisTotal: guiasManuais.guiasManuaisTotal, guiasManuaisMotivo: guiasManuais.guiasManuaisMotivo }
          : {}),
      });
    }

    // Linhas da planilha que NÃO entraram em nenhuma seleção (médico sem produção pareada, já
    // com boleto emitido, ou fora do filtro de tipo). Silenciar isso seria o pior caso: o
    // operador acharia que a conferência manual dele foi usada quando ela nem foi enviada.
    const manuaisForaDaSelecao = [...matchResultado.manuaisPorMedico.values()].filter(
      (l) => !manuaisUsados.has(l.medicoId),
    );

    return {
      matched,
      unmatched: matchResultado.unmatched,
      jaEmitidos: matchResultado.jaEmitidos,
      precisaAtencaoManual,
      finalPayload,
      manuaisForaDaSelecao,
      totalManuais: manuaisUsados.size,
    };
  }, [
    matchResultado,
    lotesPorMedicoIdBulk,
    producoes,
    consultaSelections,
    outrosHospitaisSelections,
    imobilizacoesSelections,
    cartaRedeGuiasSelections,
  ]);

  // Upload + leitura da planilha de guias manuais (migration 0058). Só PREVIEW: nada é gravado e
  // nada muda no disparo até o operador clicar em "Aplicar" abaixo.
  const lerGuiasManuais = useMutation({
    mutationFn: (arquivo: File) => execucoesService.previewGuiasManuais(arquivo, competencia),
    onSuccess: (preview, arquivo) => {
      setGuiasManuaisPreview({ competencia, arquivoNome: arquivo.name, preview });
      setGuiasManuaisErro(null);
    },
    onError: (e) => {
      const msg = e instanceof ApiClientError ? e.message : 'Erro ao ler a planilha';
      setGuiasManuaisPreview(null);
      setGuiasManuaisErro(msg);
      toast(msg, 'error');
    },
  });

  function limparGuiasManuais() {
    setGuiasManuaisPreview(null);
    setGuiasManuaisAplicadas(null);
    setGuiasManuaisErro(null);
    if (guiasManuaisInputRef.current) guiasManuaisInputRef.current.value = '';
  }

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
  // Achado 2026-09-03: com médicos ainda esperando a busca de sub-lotes (Angiologista/Pediatra/
  // Imobilizações), o botão fica desabilitado — disparar no meio do carregamento deixaria esses
  // médicos de fora do payload silenciosamente (ver FASE 3 do `selecoesInfo` acima).
  const canDispararCompetencia =
    competenciaValida && selecoesInfo.finalPayload.length > 0 && !algumLoteBulkCarregando && !disparar.isPending;

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
    ? Boolean(
        classificacaoAngiologista.cateter.length ||
          classificacaoAngiologista.fistula.length ||
          classificacaoAngiologista.angiografia.length ||
          cartaRedeGuias !== '',
      )
    : Boolean(producaoSelecionada);
  // Achado 2026-09-03: com o padrão VH (sub-lotes de Cirurgia detectados), todo sub-lote precisa
  // estar classificado (automático ou manual) antes de disparar — nunca chuta em qual tabela de
  // preço um sub-lote não reconhecido entra.
  const imobilizacoesClassificacaoOk =
    !temSubLotesCirurgiaImobilizacoes || classificacaoImobilizacoes.naoClassificados.length === 0;
  // Mesmo motivo acima, mas pro Angiologista: 1x1 (Cateter/Fístula) vs 3x1 (Angiografia) muda o
  // valor cobrado, então um sub-lote não reconhecido bloqueia até decisão manual.
  const angiologistaClassificacaoOk =
    !medicoSelecionadoAngiologista || classificacaoAngiologista.naoClassificados.length === 0;
  const canDispararMedico =
    Boolean(medicoId && competenciaValida) &&
    producaoObrigatoriaOk &&
    imobilizacoesClassificacaoOk &&
    angiologistaClassificacaoOk &&
    !medicoJaTemBoleto &&
    !disparar.isPending;

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
                    setSubLoteImobilizacoesOverride({});
                    setAngiologistaProducaoMensalId('');
                    setSubLoteAngiologistaOverride({});
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
                        // Sub-lotes de outra produção deixam de fazer sentido — evita reaproveitar
                        // uma correção manual de classificação que pertencia à produção anterior.
                        setSubLoteAngiologistaOverride({});
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
                  {/* Achado 2026-09-03: classificação automática pelo nome do sub-lote — Cateter/
                      Fístula/Carta de Rede usam palavra literal, Angiografia usa "PACOTE"
                      (confirmado pelo dono). Substitui os 3 checkboxes manuais de antes. */}
                  {angiologistaProducaoMensalId && lotesDaProducaoMensal.length > 0 && (
                    <div className="space-y-2 rounded border border-cc-border bg-cc-surface p-2.5">
                      <p className="text-xs font-medium text-cc-ink">
                        Sub-lotes classificados automaticamente pelo nome
                      </p>
                      <p className="text-xs text-cc-ink-2">
                        <span className="font-medium">{classificacaoAngiologista.cateter.length}</span> Cateter,{' '}
                        <span className="font-medium">{classificacaoAngiologista.fistula.length}</span> Fístula,{' '}
                        <span className="font-medium">{classificacaoAngiologista.angiografia.length}</span> Angiografia
                        (&ldquo;PACOTE&rdquo;) e{' '}
                        <span className="font-medium">{classificacaoAngiologista.cartaRede.length}</span> Carta de Rede.
                      </p>
                      <details className="text-xs text-cc-muted">
                        <summary className="cursor-pointer select-none">Ver sub-lotes classificados</summary>
                        <ul className="mt-1 space-y-0.5 pl-4 list-disc max-h-40 overflow-y-auto">
                          {classificacaoAngiologista.cateter.map((l) => (
                            <li key={l.id}>{l.nome} — Cateter</li>
                          ))}
                          {classificacaoAngiologista.fistula.map((l) => (
                            <li key={l.id}>{l.nome} — Fístula</li>
                          ))}
                          {classificacaoAngiologista.angiografia.map((l) => (
                            <li key={l.id}>{l.nome} — Angiografia</li>
                          ))}
                          {classificacaoAngiologista.cartaRede.map((l) => (
                            <li key={l.id}>{l.nome} — Carta de Rede (referência)</li>
                          ))}
                        </ul>
                      </details>
                      {classificacaoAngiologista.naoClassificados.length > 0 && (
                        <div className="space-y-1.5 rounded border border-cc-danger/30 bg-cc-danger-soft p-2">
                          <p role="alert" className="text-xs font-medium text-cc-danger">
                            {classificacaoAngiologista.naoClassificados.length} sub-lote(s) com nome não reconhecido
                            (nem &ldquo;CATETER&rdquo;, &ldquo;FISTULA&rdquo;, &ldquo;PACOTE&rdquo; nem &ldquo;CARTA DE REDE&rdquo;) —
                            escolha a classe manualmente para poder processar este médico.
                          </p>
                          {classificacaoAngiologista.naoClassificados.map((l) => (
                            <div key={l.id} className="flex items-center justify-between gap-2 text-xs text-cc-ink">
                              <span className="truncate">{l.nome}</span>
                              <select
                                className="input text-xs py-0.5 h-auto w-40 shrink-0"
                                value={subLoteAngiologistaOverride[l.id] ?? ''}
                                onChange={(e) =>
                                  setSubLoteAngiologistaOverride((prev) => {
                                    const valor = e.target.value;
                                    if (
                                      valor !== 'cateter' &&
                                      valor !== 'fistula' &&
                                      valor !== 'angiografia' &&
                                      valor !== 'cartaRede'
                                    ) {
                                      const { [l.id]: _remover, ...resto } = prev;
                                      return resto;
                                    }
                                    return { ...prev, [l.id]: valor };
                                  })
                                }
                                aria-label={`Classe do sub-lote ${l.nome}`}
                              >
                                <option value="">Escolher classe…</option>
                                <option value="cateter">Cateter (1x1)</option>
                                <option value="fistula">Fístula (1x1)</option>
                                <option value="angiografia">Angiografia (3x1)</option>
                                <option value="cartaRede">Carta de Rede (referência)</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label htmlFor="carta-rede-guias-input" className="field-label mb-1.5">
                      Carta de Rede — guias{' '}
                      <span className="font-normal normal-case text-cc-muted">(manual, opcional)</span>
                    </label>
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
                    <p className="mt-1.5 text-xs text-cc-muted">
                      A quantidade não tem regra fixa de contagem (depende do procedimento) — digite o número já
                      conferido. O sub-lote de referência é o classificado como Carta de Rede acima, quando houver.
                    </p>
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
                      // Mesmo motivo acima, pra correção manual de classificação de Imobilizações
                      // (achado 2026-09-03) — os sub-lotes mudam junto com a produção mensal.
                      setSubLoteImobilizacoesOverride({});
                      setImobilizacoesProducaoId('');
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
                temSubLotesConsultaAutoDetectados ? (
                  // Achado 2026-09-03: pelo menos 1 sub-lote da produção mensal já tem "CONSULTA"
                  // no nome — classificação automática, sem exigir escolha manual. Substitui o
                  // dropdown abaixo (que continua existindo pro caso sem esse padrão de nome).
                  <div className="space-y-2 rounded border border-cc-border bg-cc-surface p-2.5">
                    <p className="text-xs font-medium text-cc-ink">
                      Sub-lote(s) de Consultas detectados automaticamente pelo nome
                    </p>
                    <p className="text-xs text-cc-ink-2">
                      <span className="font-medium">{lotesConsultaAutoDetectados.length}</span> sub-lote(s) somados
                      como Consultas; o restante da produção mensal vira guia principal automaticamente.
                    </p>
                    <ul className="space-y-0.5 pl-4 text-xs text-cc-muted list-disc max-h-32 overflow-y-auto">
                      {lotesConsultaAutoDetectados.map((l) => (
                        <li key={l.id}>{l.nome}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
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
                          sub-lote de consultas. Só chega aqui quando NENHUM sub-lote tem "CONSULTA"
                          no nome (achado 2026-09-03: senão a classificação automática acima assume o
                          lugar deste seletor) — mantido como escape manual pro nome atípico. Escolher
                          um aqui muda o cálculo do guia principal também: os DEMAIS sub-lotes desta
                          produção passam a somar como guia (em vez do pacote completo), automático,
                          sem precisar marcar mais nada — ver onClick de "Processar médico" abaixo. */}
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
                )
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
                temSubLotesCirurgiaImobilizacoes ? (
                  // Padrão VH (achado 2026-09-03): a produção mensal inteira vem dividida em
                  // sub-lotes por dia/período, já nomeados com a classe — soma automática, sem
                  // exigir marcar um por um. "Produção" (seletor principal acima) deixa de ser
                  // usada pra este médico: o guia principal passa a vir da soma dos sub-lotes de
                  // Cirurgia (ver onClick de "Processar médico" abaixo).
                  <div className="space-y-2 rounded border border-cc-border bg-cc-surface p-2.5">
                    <p className="text-xs font-medium text-cc-ink">
                      Sub-lotes classificados automaticamente pelo nome
                    </p>
                    <p className="text-xs text-cc-ink-2">
                      <span className="font-medium">{classificacaoImobilizacoes.cirurgia.length}</span> sub-lote(s) de{' '}
                      <span className="font-medium">Cirurgia</span> (tabela normal, guia principal) e{' '}
                      <span className="font-medium">{classificacaoImobilizacoes.imobilizacao.length}</span> sub-lote(s) de{' '}
                      <span className="font-medium">Imobilizações</span> (tabela própria) — a &ldquo;Produção&rdquo;
                      selecionada acima não é usada para este médico.
                    </p>
                    <details className="text-xs text-cc-muted">
                      <summary className="cursor-pointer select-none">Ver sub-lotes classificados</summary>
                      <ul className="mt-1 space-y-0.5 pl-4 list-disc max-h-40 overflow-y-auto">
                        {classificacaoImobilizacoes.cirurgia.map((l) => (
                          <li key={l.id}>{l.nome} — Cirurgia</li>
                        ))}
                        {classificacaoImobilizacoes.imobilizacao.map((l) => (
                          <li key={l.id}>{l.nome} — Imobilizações</li>
                        ))}
                      </ul>
                    </details>
                    {classificacaoImobilizacoes.naoClassificados.length > 0 && (
                      <div className="space-y-1.5 rounded border border-cc-danger/30 bg-cc-danger-soft p-2">
                        <p role="alert" className="text-xs font-medium text-cc-danger">
                          {classificacaoImobilizacoes.naoClassificados.length} sub-lote(s) com nome não reconhecido
                          (nem &ldquo;CIRURGIA&rdquo; nem &ldquo;IMOBILIZ&rdquo;) — escolha a classe manualmente para poder
                          processar este médico.
                        </p>
                        {classificacaoImobilizacoes.naoClassificados.map((l) => (
                          <div key={l.id} className="flex items-center justify-between gap-2 text-xs text-cc-ink">
                            <span className="truncate">{l.nome}</span>
                            <select
                              className="input text-xs py-0.5 h-auto w-36 shrink-0"
                              value={subLoteImobilizacoesOverride[l.id] ?? ''}
                              onChange={(e) =>
                                setSubLoteImobilizacoesOverride((prev) => {
                                  const valor = e.target.value;
                                  if (valor !== 'cirurgia' && valor !== 'imobilizacao') {
                                    const { [l.id]: _remover, ...resto } = prev;
                                    return resto;
                                  }
                                  return { ...prev, [l.id]: valor };
                                })
                              }
                              aria-label={`Classe do sub-lote ${l.nome}`}
                            >
                              <option value="">Escolher classe…</option>
                              <option value="cirurgia">Cirurgia (tabela normal)</option>
                              <option value="imobilizacao">Imobilizações (tabela própria)</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
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
                          — Imobilizações já é classe separada, com tabela de preço própria. Só aparece
                          aqui quando NÃO há sub-lote de Cirurgia (senão a classificação automática
                          acima assume o lugar deste seletor). */}
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
                )
              )}

              <CampoCompetencia
                id="competencia-medico"
                value={competencia}
                onChange={setCompetencia}
              />

              {erro && <p role="alert" className="alert-error">{erro}</p>}

              <button
                onClick={() => {
                  if (!producaoObrigatoriaOk || !imobilizacoesClassificacaoOk || !angiologistaClassificacaoOk) return;
                  const consultaProd = producoesDoMedicoSelecionado.find((p) => p.id === consultaProducaoId);
                  // Achado 2026-08-21: se a escolha de Consultas é um SUB-LOTE (fin-lotes, não a
                  // lista flat de produções), o principal deixa de ser o pacote inteiro da
                  // produção mensal e passa a ser a soma dos OUTROS sub-lotes — automático, sem o
                  // operador precisar marcar mais nada (anti-dupla-contagem: ver migration 0052).
                  // Achado 2026-09-03: `lotesConsultaAutoDetectados` (nome contém "CONSULTA") tem
                  // prioridade sobre a escolha manual — os dois nunca vêm preenchidos juntos na
                  // prática (a UI só mostra o dropdown manual quando NADA foi auto-detectado).
                  const consultaLote = lotesDaProducaoMensal.find((l) => l.id === consultaProducaoId);
                  const usaConsultaAuto = temSubLotesConsultaAutoDetectados;
                  // Achado 2026-09-03: padrão VH — quando há sub-lote(s) de Cirurgia detectados, o
                  // guia principal é a soma DELES (já exclui Consultas/Imobilizações por
                  // construção de `classificacaoImobilizacoes`). Senão, quando há Consultas (manual
                  // ou automático), o guia principal é "todo o resto" da produção mensal.
                  const guiasLotesRestantes = temSubLotesCirurgiaImobilizacoes
                    ? classificacaoImobilizacoes.cirurgia
                    : usaConsultaAuto
                      ? lotesDaProducaoMensal.filter((l) => !lotesConsultaAutoDetectados.some((c) => c.id === l.id))
                      : consultaLote
                        ? lotesDaProducaoMensal.filter((l) => l.id !== consultaLote.id)
                        : [];
                  const outrosHospitaisProd = producoesDoMedicoSelecionado.find(
                    (p) => p.id === outrosHospitaisProducaoId,
                  );
                  // Achado 2026-08-25 (migration 0059: virou ARRAY): a escolha de Imobilizações
                  // pode ser um ou vários SUB-LOTES (fin-lotes) em vez de produção flat. Padrão VH
                  // (achado 2026-09-03): quando há sub-lote de Cirurgia, TODOS os sub-lotes
                  // classificados como Imobilização entram — não só o escolhido no dropdown manual
                  // (que nem aparece nesse caso, ver bloco "Lote de Imobilizações" acima).
                  const imobilizacoesLoteManual = lotesDaProducaoMensal.find((l) => l.id === imobilizacoesProducaoId);
                  const imobilizacoesProd = imobilizacoesLoteManual
                    ? undefined
                    : producoesDoMedicoSelecionado.find((p) => p.id === imobilizacoesProducaoId);
                  const imobilizacoesLotes = temSubLotesCirurgiaImobilizacoes
                    ? classificacaoImobilizacoes.imobilizacao
                    : imobilizacoesLoteManual
                      ? [imobilizacoesLoteManual]
                      : [];
                  // Achado 2026-09-03: Cateter/Fístula/Angiografia/Carta de Rede vêm da
                  // classificação automática por nome (`classificacaoAngiologista`), não mais de
                  // checkboxes marcados um a um.
                  const cateterProds = classificacaoAngiologista.cateter;
                  const fistulaProds = classificacaoAngiologista.fistula;
                  const angiografiaProds = classificacaoAngiologista.angiografia;
                  const cartaRedeProd = classificacaoAngiologista.cartaRede[0];
                  disparar.mutate({
                    competencia,
                    selecoes: [
                      {
                        medicoId,
                        // Angiologista não tem lote principal (GATE 2026-08-07) — vai null.
                        // Pediatra com sub-lote de consulta escolhido (achado 2026-08-21), ou
                        // médico no padrão VH de Imobilizações (achado 2026-09-03), também vai
                        // null — o principal vem de producaoGuiasLoteExternaIds abaixo.
                        producaoExternaId:
                          medicoSelecionadoAngiologista ||
                          consultaLote ||
                          usaConsultaAuto ||
                          temSubLotesCirurgiaImobilizacoes
                            ? null
                            : (producaoSelecionada?.id ?? null),
                        producaoNome:
                          medicoSelecionadoAngiologista ||
                          consultaLote ||
                          usaConsultaAuto ||
                          temSubLotesCirurgiaImobilizacoes
                            ? null
                            : (producaoSelecionada?.nome ?? null),
                        ...(usaConsultaAuto
                          ? {
                              producaoConsultasLoteExternaIds: lotesConsultaAutoDetectados.map((l) => l.id),
                              producaoConsultasLoteNomes: lotesConsultaAutoDetectados.map((l) => l.nome),
                            }
                          : consultaLote
                            ? {
                                producaoConsultasLoteExternaIds: [consultaLote.id],
                                producaoConsultasLoteNomes: [consultaLote.nome],
                              }
                            : consultaProd
                              ? { producaoConsultasExternaId: consultaProd.id, producaoConsultasNome: consultaProd.nome }
                              : {}),
                        ...(consultaLote || usaConsultaAuto || temSubLotesCirurgiaImobilizacoes
                          ? {
                              producaoGuiasLoteExternaIds: guiasLotesRestantes.map((l) => l.id),
                              producaoGuiasLoteNomes: guiasLotesRestantes.map((l) => l.nome),
                            }
                          : {}),
                        ...(outrosHospitaisProd
                          ? {
                              producaoOutrosHospitaisExternaId: outrosHospitaisProd.id,
                              producaoOutrosHospitaisNome: outrosHospitaisProd.nome,
                            }
                          : {}),
                        ...(imobilizacoesLotes.length
                          ? {
                              producaoImobilizacoesLoteExternaIds: imobilizacoesLotes.map((l) => l.id),
                              producaoImobilizacoesLoteNomes: imobilizacoesLotes.map((l) => l.nome),
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

                {algumLoteBulkCarregando && (
                  <p className="text-xs text-cc-muted">
                    Carregando sub-lotes de Angiologista/Pediatra/Imobilizações…
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!canDispararCompetencia}
                  className="btn-primary w-full py-2.5"
                >
                  {disparar.isPending
                    ? 'Disparando...'
                    : `Processar ${selecoesInfo.finalPayload.length} médicos${
                        selecoesInfo.totalManuais > 0 ? ` (${selecoesInfo.totalManuais} com contagem manual)` : ''
                      }`}
                </button>
              </form>
            </div>

            {/* Planilha de guias conferidas MANUALMENTE (migration 0058, aprovado 2026-09-03).
                Função ALTERNATIVA e pontual: quando a contagem automática não bate com a
                conferência do dono, ele informa o total já conferido desses médicos e o motor
                pula a contagem só neles. Quem não está na planilha segue 100% automático na
                MESMA emissão. Upload → preview → aplicar: o número nunca entra no cálculo sem o
                operador ter visto médico por médico antes (é dinheiro real). */}
            <div className="card p-6 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-cc-ink">Guias conferidas manualmente (opcional)</h3>
                <p className="mt-1 text-xs text-cc-muted">
                  Substitui a contagem automática de guias APENAS dos médicos que vierem na planilha, nesta
                  competência. Os demais continuam no cálculo normal. A marca de contagem manual aparece só no
                  relatório interno — nunca no boleto.
                </p>
                <a href="/templates/guias-manuais-modelo.csv" download className="mt-1.5 inline-block text-xs text-cc-accent underline">
                  Baixar modelo da planilha (.csv)
                </a>
              </div>

              <input
                ref={guiasManuaisInputRef}
                id="guias-manuais-arquivo"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="input text-xs"
                aria-label="Planilha de guias conferidas manualmente"
                disabled={!competenciaValida || lerGuiasManuais.isPending}
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) lerGuiasManuais.mutate(arquivo);
                }}
              />
              {!competenciaValida && (
                <p className="text-xs text-cc-muted">Informe a competência antes de enviar a planilha.</p>
              )}
              {lerGuiasManuais.isPending && <p className="text-xs text-cc-muted">Lendo a planilha…</p>}
              {guiasManuaisErro && <p role="alert" className="alert-error">{guiasManuaisErro}</p>}

              {/* Preview: ainda NÃO afeta o disparo. */}
              {guiasManuaisPreview && guiasManuaisPreview.competencia === competencia && !guiasManuaisAplicadas && (
                <div className="space-y-2 rounded border border-cc-border bg-cc-surface p-2">
                  <p className="text-xs text-cc-ink-2">
                    <span className="font-medium">{guiasManuaisPreview.arquivoNome}</span> —{' '}
                    {guiasManuaisPreview.preview.linhas.length} médico(s) casado(s) por CPF,{' '}
                    {guiasManuaisPreview.preview.erros.length} linha(s) com erro.
                  </p>
                  {guiasManuaisPreview.preview.linhas.length > 0 && (
                    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {guiasManuaisPreview.preview.linhas.map((l) => (
                        <div key={l.medicoId} className="rounded bg-cc-surface-2/60 p-1.5 text-xs text-cc-ink">
                          <div className="flex justify-between gap-2">
                            <span className="truncate font-medium">{l.medicoNome}</span>
                            <span className="shrink-0 tabular">{l.guiasManuaisTotal} guias</span>
                          </div>
                          <p className="mt-0.5 text-cc-muted">
                            CPF {l.cpf} · linha {l.linha} · {l.guiasManuaisMotivo}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {guiasManuaisPreview.preview.erros.length > 0 && (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-cc-danger/25 p-1.5">
                      {guiasManuaisPreview.preview.erros.map((e) => (
                        <p key={`${e.linha}-${e.chave}`} className="text-xs text-cc-danger">
                          Linha {e.linha} ({e.chave || 'sem CPF'}): {e.erro}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary btn btn-sm"
                      disabled={guiasManuaisPreview.preview.linhas.length === 0}
                      onClick={() =>
                        setGuiasManuaisAplicadas({
                          competencia: guiasManuaisPreview.competencia,
                          arquivoNome: guiasManuaisPreview.arquivoNome,
                          linhas: guiasManuaisPreview.preview.linhas,
                        })
                      }
                    >
                      Aplicar a {guiasManuaisPreview.preview.linhas.length} médico(s)
                    </button>
                    <button type="button" className="btn-ghost btn btn-sm" onClick={limparGuiasManuais}>
                      Descartar
                    </button>
                  </div>
                  <p className="text-xs text-cc-muted">
                    Linhas com erro nunca entram: corrija a planilha e envie de novo, ou siga sem elas (esses
                    médicos ficam na contagem automática).
                  </p>
                </div>
              )}

              {/* Já aplicado: é o que de fato vai no disparo. */}
              {guiasManuaisAplicadas && guiasManuaisAplicadas.competencia === competencia && (
                <div className="space-y-2 rounded border border-cc-warning/25 bg-cc-warning-soft p-2">
                  <p className="text-xs text-cc-ink">
                    <span className="font-medium">{selecoesInfo.totalManuais} médico(s)</span> vão entrar com
                    contagem MANUAL nesta emissão (de {guiasManuaisAplicadas.arquivoNome}).
                  </p>
                  {selecoesInfo.manuaisForaDaSelecao.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-cc-danger">
                        {selecoesInfo.manuaisForaDaSelecao.length} médico(s) da planilha NÃO entram nesta emissão
                        (sem produção pareada, já com boleto emitido, ou fora do filtro de tipo) — o total
                        conferido deles será ignorado:
                      </p>
                      {selecoesInfo.manuaisForaDaSelecao.map((l) => (
                        <p key={l.medicoId} className="text-xs text-cc-ink-2">
                          {l.medicoNome} ({l.guiasManuaisTotal} guias)
                        </p>
                      ))}
                    </div>
                  )}
                  <button type="button" className="btn-ghost btn btn-sm" onClick={limparGuiasManuais}>
                    Remover contagem manual
                  </button>
                </div>
              )}

              {/* A planilha foi lida contra outra competência — não vale mais. */}
              {(guiasManuaisPreview ?? guiasManuaisAplicadas) &&
                (guiasManuaisAplicadas ?? guiasManuaisPreview)!.competencia !== competencia && (
                  <p role="alert" className="alert-error">
                    A planilha foi lida para a competência{' '}
                    {(guiasManuaisAplicadas ?? guiasManuaisPreview)!.competencia} e não vale para {competencia || '—'}.
                    Envie novamente.
                  </p>
                )}
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
                        {selecoesInfo.matched.map(({ medico, producao, guiasManuais, angiologista, usaConsultaAuto, temCirurgiaVh }) => {
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
                              {/* Migration 0058: deixa explícito, ANTES do disparo, que este
                                  médico não vai ser contado pelo motor. */}
                              {guiasManuais && (
                                <p className="rounded bg-cc-warning-soft px-1.5 py-1 text-xs text-cc-warning">
                                  Contagem MANUAL: {guiasManuais.guiasManuaisTotal} guias — {guiasManuais.guiasManuaisMotivo}
                                </p>
                              )}
                              {/* Achado 2026-09-03: quando a produção mensal tem sub-lote de Consultas
                                  ("CONSULTA" no nome), a classificação automática já resolve — o
                                  dropdown manual só aparece pro caso sem esse padrão. */}
                              {usaConsultaAuto ? (
                                <p className="rounded bg-cc-surface-2/60 px-1.5 py-1 text-xs text-cc-ink-2">
                                  Consultas detectadas automaticamente pelo nome do sub-lote.
                                </p>
                              ) : (
                                pediatra &&
                                outrasProducoes.length > 0 && (
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
                                )
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
                              {/* Achado 2026-09-03: padrão VH (sub-lotes de Cirurgia detectados) já
                                  resolve Imobilizações automaticamente — o dropdown manual só aparece
                                  pro caso sem esse padrão (produção flat + no máx. 1 sub-lote). */}
                              {temCirurgiaVh ? (
                                <p className="rounded bg-cc-surface-2/60 px-1.5 py-1 text-xs text-cc-ink-2">
                                  Cirurgia/Imobilizações detectadas automaticamente pelo nome do sub-lote.
                                </p>
                              ) : (
                                medico.fazImobilizacoes &&
                                outrasProducoes.length > 0 && (
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
                                )
                              )}
                              {/* Achado 2026-09-03: Angiologista — Cateter/Fístula/Angiografia já vêm
                                  classificados automaticamente pelo nome; só a Carta de Rede continua
                                  manual (sem regra de contagem fixa, mesmo motivo do modo "Por médico"). */}
                              {angiologista && (
                                <div className="flex items-center gap-2">
                                  <p className="flex-1 rounded bg-cc-surface-2/60 px-1.5 py-1 text-xs text-cc-ink-2">
                                    Cateter/Fístula/Angiografia classificados automaticamente.
                                  </p>
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    className="input text-xs py-1 h-auto w-28"
                                    placeholder="Carta de Rede"
                                    value={cartaRedeGuiasSelections[medico.id] ?? ''}
                                    onChange={(e) =>
                                      setCartaRedeGuiasSelections((prev) => ({ ...prev, [medico.id]: e.target.value }))
                                    }
                                    aria-label={`Carta de Rede — guias de ${medico.nome} (opcional)`}
                                  />
                                </div>
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

                  {/* Achado 2026-09-03: sub-lote com nome não reconhecido (Angiologista ou
                      Imobilizações no padrão VH) — nunca chuta em qual classe ele entra; pede pra
                      processar esse médico individualmente pelo modo "Por médico", que tem a tela
                      de correção manual por sub-lote. */}
                  {selecoesInfo.precisaAtencaoManual.length > 0 && (
                    <div className="pt-4 border-t border-cc-border">
                      <h3 className="mb-2 flex items-center gap-1.5 font-medium text-cc-warning">
                        <AlertTriangleIcon className="shrink-0" />
                        Requer atenção manual ({selecoesInfo.precisaAtencaoManual.length})
                      </h3>
                      <p className="text-xs text-cc-muted mb-3">
                        Sub-lote com nome não reconhecido pela classificação automática — processe estes médicos
                        pelo modo &ldquo;Por médico&rdquo; para revisar/classificar antes de cobrar.
                      </p>
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-2">
                        {selecoesInfo.precisaAtencaoManual.map(({ medico, motivo }) => (
                          <div key={medico.id} className="rounded border border-cc-warning/25 bg-cc-warning-soft p-2 text-xs text-cc-ink">
                            <span className="font-medium">{medico.nome}</span>
                            <p className="mt-0.5 text-cc-ink-2">{motivo}</p>
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
