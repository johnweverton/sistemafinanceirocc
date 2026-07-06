import type { ItemProducao, ResultadoContagem, ModoObservado } from '@cobranca/shared';
import { isPediatra } from './contagem';

/**
 * Filtra itens válidos e inválidos.
 * Exige data e pacienteNome presentes. O statusOrigem NUNCA filtra.
 */
export function itensValidos(itens: ItemProducao[]): { validos: ItemProducao[]; invalidos: ItemProducao[] } {
  const validos: ItemProducao[] = [];
  const invalidos: ItemProducao[] = [];

  for (const item of itens) {
    if (item.data && item.data.trim() !== '' && item.pacienteNome && item.pacienteNome.trim() !== '') {
      validos.push(item);
    } else {
      invalidos.push(item);
    }
  }

  return { validos, invalidos };
}

/**
 * Retorna a chave de atendimento para agrupar guias.
 * Usa atendimentoExternoId (senha/atendimento na origem) se disponível.
 * Fallback: pacienteNome|data.
 */
export function chaveAtendimento(item: ItemProducao): string {
  if (item.atendimentoExternoId && item.atendimentoExternoId.trim() !== '') {
    return item.atendimentoExternoId;
  }
  return `${item.pacienteNome}|${item.data}`;
}

/**
 * Conta as guias e cirurgias a partir de itens da produção (via API), adaptado à semântica real:
 * - itens viaAcesso: 1 guia por chaveAtendimento, independente da especialidade.
 * - itens normais (pediatra): agrupados por (chaveAtendimento, data), cada balde = teto(qtd/3) guias.
 * - itens normais (não pediatra): 1 guia por item.
 */
export function contarGuiasProducao(itens: ItemProducao[], especialidade?: string | null): ResultadoContagem {
  const { validos } = itensValidos(itens);

  const viaAcessoItems = validos.filter((i) => i.viaAcesso);
  const outrosItems = validos.filter((i) => !i.viaAcesso);

  let guias = 0;
  let cirurgias = 0;

  // viaAcesso agrupa por chaveAtendimento
  const viaAcessoGroups = new Set<string>();
  for (const item of viaAcessoItems) {
    viaAcessoGroups.add(chaveAtendimento(item));
  }
  guias += viaAcessoGroups.size;
  cirurgias += viaAcessoGroups.size;

  // Remaining
  if (isPediatra(especialidade)) {
    // Pediatra
    const porAtend = new Map<string, Map<string, number>>();
    for (const item of outrosItems) {
      const chave = chaveAtendimento(item);
      let datas = porAtend.get(chave);
      if (!datas) {
        datas = new Map<string, number>();
        porAtend.set(chave, datas);
      }
      datas.set(item.data, (datas.get(item.data) ?? 0) + 1);
    }

    for (const datas of porAtend.values()) {
      for (const count of datas.values()) {
        guias += Math.ceil(count / 3);
      }
    }
  } else {
    // Não-pediatra
    guias += outrosItems.length;
  }

  return { guias, cirurgias };
}

/**
 * Detecta se existem grupos viaAcesso do mesmo paciente com itens em mais de uma data.
 */
export function detectarModoProducao(itens: ItemProducao[]): ModoObservado {
  const { validos } = itensValidos(itens);
  const viaAcessoItems = validos.filter((i) => i.viaAcesso);

  const porPaciente = new Map<string, Set<string>>();
  for (const item of viaAcessoItems) {
    let datas = porPaciente.get(item.pacienteNome);
    if (!datas) {
      datas = new Set<string>();
      porPaciente.set(item.pacienteNome, datas);
    }
    datas.add(item.data);
  }

  for (const datas of porPaciente.values()) {
    if (datas.size > 1) return 'sim';
  }

  return 'nao';
}

/**
 * Contagem informativa ignorando a data no agrupamento.
 */
export function consolidarProducao(itens: ItemProducao[], especialidade?: string | null): number {
  const { validos } = itensValidos(itens);

  const viaAcessoItems = validos.filter((i) => i.viaAcesso);
  const outrosItems = validos.filter((i) => !i.viaAcesso);

  let guias = 0;

  // viaAcesso agrupa por paciente
  const viaAcessoPacientes = new Set<string>();
  for (const item of viaAcessoItems) {
    viaAcessoPacientes.add(item.pacienteNome);
  }
  guias += viaAcessoPacientes.size;

  if (isPediatra(especialidade)) {
    const porPaciente = new Map<string, number>();
    for (const item of outrosItems) {
      porPaciente.set(item.pacienteNome, (porPaciente.get(item.pacienteNome) ?? 0) + 1);
    }
    for (const count of porPaciente.values()) {
      guias += Math.ceil(count / 3);
    }
  } else {
    guias += outrosItems.length;
  }

  return guias;
}
