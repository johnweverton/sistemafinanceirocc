// Montagem do payload da execução + resumo impresso no terminal. Funções puras.
import type { NovaCapturaIss, NovaExecucaoIss, StatusCapturaIss } from '@cobranca/shared';

export interface ResultadoEmpresa {
  nome: string;
  documento: string;
  captura: NovaCapturaIss;
}

export function montarExecucao(params: {
  competencia: string;
  iniciadoEm: Date;
  finalizadoEm: Date;
  maquina: string;
  versaoAgente: string;
  resultados: ResultadoEmpresa[];
}): NovaExecucaoIss {
  return {
    competencia: params.competencia,
    iniciadoEm: params.iniciadoEm.toISOString(),
    finalizadoEm: params.finalizadoEm.toISOString(),
    maquina: params.maquina,
    versaoAgente: params.versaoAgente,
    capturas: params.resultados.map((r) => r.captura),
    ciencias: [], // G2: ciência automática ainda não validada no portal real (ver portal.ts)
  };
}

const ROTULO: Record<StatusCapturaIss, string> = {
  capturado: 'capturado',
  nao_encontrado: 'não encontrado',
  sem_escrituracao: 'sem escrituração',
  erro: 'ERRO',
};

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function resumoTexto(competencia: string, resultados: ResultadoEmpresa[]): string {
  const linhas = resultados.map((r) => {
    const c = r.captura;
    const detalhe =
      c.status === 'capturado'
        ? `${brl(c.valorServicosPrestados ?? 0)} · ${c.situacaoIss ?? ''}${c.competenciaFechada === false ? ' ⚠ competência ABERTA' : ''}`
        : (c.mensagemErro ?? '');
    return `  ${ROTULO[c.status].padEnd(16)} ${r.nome.slice(0, 40).padEnd(40)} ${detalhe}`;
  });
  const totais = resultados.reduce<Record<string, number>>((acc, r) => {
    acc[r.captura.status] = (acc[r.captura.status] ?? 0) + 1;
    return acc;
  }, {});
  const rodape = (Object.keys(ROTULO) as StatusCapturaIss[])
    .filter((s) => totais[s])
    .map((s) => `${totais[s]} ${ROTULO[s]}`)
    .join(' · ');
  return [`Competência ${competencia}:`, ...linhas, `Total: ${rodape || 'nenhuma empresa'}`].join('\n');
}
