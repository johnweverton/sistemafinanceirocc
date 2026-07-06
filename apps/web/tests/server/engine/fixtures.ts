// Fixtures dos casos reais validados do PRD §12 — teste de regressão obrigatório do motor.
// Os arquivos xlsx originais (DRA__A, DR__E) não estão no repo; reproduzimos aqui a
// MESMA estrutura descrita no PRD §12, que é o que o motor Python consumia.
import type { ItemProducao } from '@cobranca/shared';

function proc(over: Partial<ItemProducao> & { atendimentoExternoId: string; data: string; pacienteNome: string }): ItemProducao {
  return {
    data: '2026-06-15',
    pacienteNome: 'Paciente Padrão',
    codigoProcedimento: '00000000',
    descricaoProcedimento: 'Procedimento cirúrgico',
    statusOrigem: 'Devidamente Pago',
    viaAcesso: false,
    tipoAto: 'Eletivo',
    valorCobradoOrigem: 100,
    valorPagoOrigem: 100,
    ...over,
  };
}

/**
 * Dra. A — modo SIM (muda data), PRD §12:
 *   17 procedimentos, 17 senhas, 4 cirurgias.
 *   Cada cirurgia espalhada em datas consecutivas, UM procedimento por dia.
 *   Distribuição de procedimentos por cirurgia: [3, 3, 5, 6] (soma 17).
 *   Contagem por (atend, data): cada balde tem 1 proc → 17 guias.
 *   Consolidado por cirurgia: ceil(3/3)+ceil(3/3)+ceil(5/3)+ceil(6/3) = 1+1+2+2 = 6 guias.
 *   1 procedimento sem valor → alerta de dado incompleto.
 */
export const procedimentosDraA: ItemProducao[] = (() => {
  const distribuicao = [3, 3, 5, 6]; // 4 cirurgias, total 17
  const linhas: ItemProducao[] = [];
  let senhaSeq = 0;
  distribuicao.forEach((qtd, ci) => {
    const atend = `ATEND-A-${ci + 1}`;
    for (let i = 0; i < qtd; i++) {
      senhaSeq += 1;
      // modo SIM: cada procedimento em um dia diferente (datas consecutivas).
      const dia = String(1 + i).padStart(2, '0');
      linhas.push(
        proc({
          pacienteNome: 'Paciente',
          atendimentoExternoId: atend, // O motor antigo agrupava por numeroAtendimento
          data: `2026-06-${dia}`,
        }),
      );
    }
  });
  // 1 procedimento sem valor (código ou descricao nulo para acionar regra do motor real) → dado incompleto (PRD §12).
  linhas[0] = { ...linhas[0]!, codigoProcedimento: '' };
  return linhas;
})();

/**
 * Dr. E — modo NÃO (não muda data), PRD §12:
 *   49 procedimentos, 49 senhas, 16 cirurgias.
 *   Cada cirurgia com TODOS os procedimentos na MESMA data.
 *   Distribuição: 15 cirurgias de 3 procedimentos + 1 cirurgia de 4 (soma 49).
 *   Contagem por (atend, data): ceil(3/3)×15 + ceil(4/3) = 15 + 2 = 17 guias.
 *   6 procedimentos sem valor → alerta de dado incompleto.
 */
export const procedimentosDrE: ItemProducao[] = (() => {
  const distribuicao = [...Array(15).fill(3), 4]; // 16 cirurgias, total 49
  const linhas: ItemProducao[] = [];
  let senhaSeq = 0;
  distribuicao.forEach((qtd, ci) => {
    const atend = `ATEND-E-${ci + 1}`;
    const dia = String(1 + (ci % 28)).padStart(2, '0');
    for (let i = 0; i < qtd; i++) {
      senhaSeq += 1;
      // modo NÃO: data única por cirurgia (todos os procedimentos no mesmo dia).
      linhas.push(
        proc({
          pacienteNome: 'Paciente',
          atendimentoExternoId: atend,
          data: `2026-06-${dia}`,
        }),
      );
    }
  });
  // 6 procedimentos sem valor (código ou descricao nulo) → dado incompleto (PRD §12).
  for (let i = 0; i < 6; i++) {
    linhas[i] = { ...linhas[i]!, codigoProcedimento: '' };
  }
  return linhas;
})();
