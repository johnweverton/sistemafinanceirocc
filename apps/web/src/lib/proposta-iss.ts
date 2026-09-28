// Estado da proposta do ISS para UM cliente no diálogo de lote (Story 13.3, Épico 13).
// Lógica pura: decide se o campo de faturamento vem pré-preenchido e qual aviso acompanha o valor.
// Regras da arquitetura (docs/architecture/feature-agente-faturamento-iss.md §3 e §6):
//   - R2: competência aberta no ISS pré-preenche, mas avisa que o valor pode mudar;
//   - R4: já existe lançamento com valor diferente ⇒ NÃO pré-preenche, mostra a divergência;
//   - R5: captura com alerta (ex.: valor 0 depois da migração ao Emissor Nacional) ⇒ NÃO
//     pré-preenche; o operador precisa olhar antes de aceitar;
//   - captura sem valor (não encontrado / sem escrituração / erro) ⇒ campo vazio, digitação manual.
import type { CapturaIss } from '@cobranca/shared';
import { brl } from './formato';

export type EstadoPropostaIss =
  | { tipo: 'sem_captura' }
  | { tipo: 'indisponivel'; captura: CapturaIss }
  | { tipo: 'preenchivel'; captura: CapturaIss; valor: number; aberta: boolean }
  | { tipo: 'alerta'; captura: CapturaIss; valor: number }
  | { tipo: 'divergente'; captura: CapturaIss; valor: number; lancado: number }
  | { tipo: 'confere'; captura: CapturaIss; valor: number; lancado: number };

/** Compara em centavos: 0.1 + 0.2 e afins não podem criar divergência fantasma. */
export function mesmoValor(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export function estadoPropostaIss(
  captura: CapturaIss | undefined,
  lancado: number | undefined,
): EstadoPropostaIss {
  if (!captura) return { tipo: 'sem_captura' };
  if (captura.status !== 'capturado' || captura.valorServicosPrestados === null) {
    return { tipo: 'indisponivel', captura };
  }
  const valor = captura.valorServicosPrestados;
  if (lancado !== undefined) {
    return mesmoValor(valor, lancado)
      ? { tipo: 'confere', captura, valor, lancado }
      : { tipo: 'divergente', captura, valor, lancado };
  }
  if (captura.alertas.length > 0) return { tipo: 'alerta', captura, valor };
  return { tipo: 'preenchivel', captura, valor, aberta: captura.competenciaFechada === false };
}

/** Valor que o campo mostra quando o operador ainda não mexeu nele. */
export function valorInicialDoCampo(estado: EstadoPropostaIss): string {
  return estado.tipo === 'preenchivel' ? String(estado.valor) : '';
}

/**
 * Captura a citar no lançamento: só quando o valor final do campo é EXATAMENTE o da proposta.
 * (O servidor confere de novo — isto só evita alegar proveniência que o operador desfez ao digitar.)
 */
export function capturaAceita(estado: EstadoPropostaIss, valorFinal: number): string | undefined {
  if (estado.tipo === 'sem_captura' || estado.tipo === 'indisponivel') return undefined;
  return mesmoValor(estado.valor, valorFinal) ? estado.captura.id : undefined;
}

// ---------------------------------------------------------------------------------------------
// Story 13.4 (AC 1) — camada VISUAL por cima de `estadoPropostaIss`. O diálogo de lote tinha ~7
// selos diferentes em letra miúda, com jargão do portal ("Fechada - Retificadora(N)"); o operador
// não técnico não sabia o que fazer com cada um. Agora são 3 estados, cada um com UMA ação:
//   - verde  "Veio do ISS"   → o valor veio do portal e pode ser usado;
//   - amarelo "Confira"      → há um valor, mas algo pede conferência (uma frase diz o quê);
//   - cinza  "Digite à mão"  → o agente não trouxe valor; o motivo vai em português.
// O jargão técnico (situação do ISS, status bruto, horário da captura) não some: vai para
// `detalheTecnico`, que a tela coloca só no `title` (hover/foco). As regras R2/R4/R5 continuam
// inteiramente em `estadoPropostaIss` — esta função só traduz o estado já decidido.
// ---------------------------------------------------------------------------------------------

export type TomSeloIss = 'verde' | 'amarelo' | 'cinza';
export type RotuloSeloIss = 'Veio do ISS' | 'Confira' | 'Digite à mão';

export interface ClassificacaoVisualIss {
  tom: TomSeloIss;
  rotulo: RotuloSeloIss;
  /** Uma frase, sem jargão do portal, dizendo por que conferir/digitar. `null` no verde. */
  motivo: string | null;
  /** Situação do ISS, status bruto e horário da captura — só para o `title` do selo. */
  detalheTecnico: string | null;
}

function dataHoraCaptura(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function detalheTecnicoDa(captura: CapturaIss): string {
  const partes = [
    `Situação no ISS: ${captura.situacaoIss ?? '—'}`,
    `status da captura: ${captura.status}`,
    `capturado em ${dataHoraCaptura(captura.capturadoEm)}`,
  ];
  if (captura.mensagemErro) partes.push(`mensagem: ${captura.mensagemErro}`);
  return partes.join(' · ');
}

function motivoIndisponivel(captura: CapturaIss): string {
  switch (captura.status) {
    case 'nao_encontrado':
      return 'empresa não encontrada no portal do ISS';
    case 'sem_escrituracao':
      return 'sem escrituração nesta competência (não significa faturamento zero)';
    default:
      return 'falha na leitura do ISS';
  }
}

export function classificacaoVisualIss(estado: EstadoPropostaIss): ClassificacaoVisualIss | null {
  switch (estado.tipo) {
    case 'sem_captura':
      return null;
    case 'preenchivel':
      return estado.aberta
        ? {
            tom: 'amarelo',
            rotulo: 'Confira',
            motivo: 'competência ainda aberta no ISS — o valor pode mudar',
            detalheTecnico: detalheTecnicoDa(estado.captura),
          }
        : { tom: 'verde', rotulo: 'Veio do ISS', motivo: null, detalheTecnico: detalheTecnicoDa(estado.captura) };
    case 'confere':
      return { tom: 'verde', rotulo: 'Veio do ISS', motivo: null, detalheTecnico: detalheTecnicoDa(estado.captura) };
    case 'alerta':
      return {
        tom: 'amarelo',
        rotulo: 'Confira',
        motivo: `possível nota fora da escrituração (ISS ${brl(estado.valor)}) — confira antes de digitar`,
        detalheTecnico: detalheTecnicoDa(estado.captura),
      };
    case 'divergente':
      return {
        tom: 'amarelo',
        rotulo: 'Confira',
        motivo: `lançado ${brl(estado.lancado)} difere do ISS ${brl(estado.valor)}`,
        detalheTecnico: detalheTecnicoDa(estado.captura),
      };
    case 'indisponivel':
      return {
        tom: 'cinza',
        rotulo: 'Digite à mão',
        motivo: motivoIndisponivel(estado.captura),
        detalheTecnico: detalheTecnicoDa(estado.captura),
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Story 13.4 (AC 12) — link de volta do agente: `/clientes-contabilidade?lote=AAAA-MM` abre o
// diálogo de lote já com os clientes que o agente buscou no ISS.
// ---------------------------------------------------------------------------------------------

/** `?lote=` válido (AAAA-MM, mês 01–12) → a competência; ausente ou inválido → `null`. */
export function competenciaDoLinkLote(param: string | null | undefined): string | null {
  if (!param) return null;
  const valor = param.trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor) ? valor : null;
}

/**
 * Clientes que o agente do ISS atende: ativos em `faixa_faturamento` — MESMO critério de
 * `listarAlvosIss` (apps/web/src/server/repositories/iss-captura-repository.ts).
 */
export function clientesAlvoDoIss<T extends { ativo: boolean; modoCobranca: string }>(clientes: T[]): T[] {
  return clientes.filter((c) => c.ativo && c.modoCobranca === 'faixa_faturamento');
}
