// Importação da planilha de GUIAS CONFERIDAS MANUALMENTE (migration 0058, aprovado 2026-09-03).
// Diferente dos outros 3 importadores (médicos/empresas/clientes de contabilidade), este NÃO
// grava nada: ele só RESOLVE cada linha da planilha contra o cadastro (CPF → médico) e devolve o
// que o operador precisa conferir na tela antes de disparar a execução. O número só vira dado
// persistido quando ele confirma o disparo, dentro de `execucao_selecoes`.
//
// Por isso não reaproveita `processarLinhas` (planilha-import.ts), que é um loop
// linha→schema→criar/atualizar no banco; aqui reaproveita o parsing (`parseCsv`/`parseExcel`) e o
// formato de erro por linha (`ErroLinha`), que é o que de fato se repete entre os importadores.
//
// Regra de ouro (PRD §2, nunca chuta): toda linha que não resolve com certeza vira ERRO EXPLÍCITO
// de linha — nunca é ignorada em silêncio, nunca "escolhe o mais parecido". É dinheiro real.
import type { Medico } from '@cobranca/shared';
import { parseCsv, parseExcel, type ErroLinha } from './planilha-import';

export { parseCsv, parseExcel };

/** Colunas esperadas — ver o template público `public/templates/guias-manuais-modelo.csv`. */
export const COLUNAS_GUIAS_MANUAIS = ['cpf', 'nome', 'competencia', 'total_guias', 'motivo'] as const;

/** Uma linha da planilha já casada com um médico do cadastro. */
export interface LinhaGuiasManuais {
  /** Número da linha no arquivo (1 = cabeçalho), para o operador achar o erro na planilha. */
  linha: number;
  medicoId: string;
  /** Nome do CADASTRO (não o da planilha) — é o que o operador confere na tela. */
  medicoNome: string;
  /** CPF normalizado (só dígitos) usado no cruzamento. */
  cpf: string;
  /** Nome como veio na planilha — só conferência visual; NUNCA usado para casar o médico. */
  nomePlanilha: string;
  competencia: string;
  guiasManuaisTotal: number;
  guiasManuaisMotivo: string;
}

export interface ResultadoGuiasManuais {
  linhas: LinhaGuiasManuais[];
  erros: ErroLinha[];
}

/** Só dígitos — o CPF pode vir formatado (000.000.000-00) da planilha do dono. */
export function normalizarCpf(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/**
 * Resolve as linhas da planilha contra o cadastro de médicos.
 *
 * `medicos` deve ser a lista de médicos do cadastro (a rota passa os ATIVOS); o cruzamento é
 * SEMPRE por CPF — a coluna `nome` da planilha existe só para o operador conferir visualmente na
 * tela que o CPF casou com quem ele esperava (nome é ambíguo/homônimo, nunca vira chave).
 *
 * Vira erro de linha, nunca descarte silencioso:
 *  - CPF vazio ou com menos de 11 dígitos;
 *  - CPF repetido na própria planilha (TODAS as ocorrências viram erro — se dois totais
 *    diferentes foram informados para o mesmo médico, escolher um seria chutar);
 *  - CPF que não existe no cadastro (ou existe mas está fora da emissão: inativo, pendente de
 *    configuração ou sem vínculo com a origem — melhor barrar aqui do que o disparo inteiro
 *    falhar com 422 depois de o operador confirmar);
 *  - competência da planilha diferente da competência da execução (mistura de meses é o erro
 *    mais caro possível aqui: cobraria o número de outro mês);
 *  - total de guias ausente, não inteiro ou negativo;
 *  - motivo vazio (é o texto que vai para o alerta de auditoria do relatório interno).
 */
export function resolverGuiasManuais(
  rows: Record<string, string>[],
  medicos: Medico[],
  competenciaExecucao: string,
): ResultadoGuiasManuais {
  const medicosPorCpf = new Map<string, Medico>();
  for (const m of medicos) {
    const cpf = normalizarCpf(m.cpf);
    if (cpf) medicosPorCpf.set(cpf, m);
  }

  // Pré-varredura de CPFs repetidos: precisa ser feita ANTES de montar as linhas válidas, senão a
  // primeira ocorrência já teria entrado na lista antes de a segunda aparecer.
  const ocorrencias = new Map<string, number>();
  for (const row of rows) {
    const cpf = normalizarCpf(row.cpf);
    if (cpf) ocorrencias.set(cpf, (ocorrencias.get(cpf) ?? 0) + 1);
  }

  const linhas: LinhaGuiasManuais[] = [];
  const erros: ErroLinha[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const linha = i + 2; // +2: 1 do cabeçalho + 1 do índice base-zero (mesma conta de processarLinhas)
    const cpfBruto = (row.cpf ?? '').trim();
    const cpf = normalizarCpf(cpfBruto);
    const chave = cpfBruto || (row.nome ?? '').trim();
    const erro = (mensagem: string) => erros.push({ linha, chave, erro: mensagem });

    if (!cpf) {
      erro('CPF não informado — é a chave de cruzamento com o cadastro (coluna cpf)');
      continue;
    }
    if (cpf.length !== 11) {
      erro(`CPF "${cpfBruto}" inválido: esperados 11 dígitos, encontrados ${cpf.length}`);
      continue;
    }
    if ((ocorrencias.get(cpf) ?? 0) > 1) {
      erro(
        `CPF ${cpf} aparece ${ocorrencias.get(cpf)}× na planilha — deixe uma linha só por médico ` +
          '(qual total valeria não pode ser adivinhado)',
      );
      continue;
    }

    const medico = medicosPorCpf.get(cpf);
    if (!medico) {
      erro(`CPF ${cpf} não encontrado no cadastro de médicos`);
      continue;
    }
    if (!medico.ativo) {
      erro(`${medico.nome} (CPF ${cpf}) está inativo no cadastro`);
      continue;
    }
    if (medico.necessitaConfiguracao) {
      erro(`${medico.nome} (CPF ${cpf}) está com cadastro pendente de configuração`);
      continue;
    }
    if (!medico.externalId) {
      erro(`${medico.nome} (CPF ${cpf}) não tem vínculo com o sistema de origem`);
      continue;
    }

    const competencia = (row.competencia ?? '').trim();
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      erro(`Competência "${competencia}" inválida — use o formato AAAA-MM (ex.: ${competenciaExecucao})`);
      continue;
    }
    if (competencia !== competenciaExecucao) {
      erro(
        `Competência da planilha (${competencia}) é diferente da competência desta emissão ` +
          `(${competenciaExecucao})`,
      );
      continue;
    }

    const totalBruto = (row.total_guias ?? '').trim();
    if (totalBruto === '') {
      erro('Total de guias não informado (coluna total_guias)');
      continue;
    }
    const total = Number(totalBruto);
    if (!Number.isInteger(total) || total < 0) {
      erro(`Total de guias "${totalBruto}" inválido: informe um número inteiro maior ou igual a 0`);
      continue;
    }

    const motivo = (row.motivo ?? '').trim();
    if (!motivo) {
      erro('Motivo não informado (coluna motivo) — é o texto que fica registrado no relatório interno');
      continue;
    }

    linhas.push({
      linha,
      medicoId: medico.id,
      medicoNome: medico.nome,
      cpf,
      nomePlanilha: (row.nome ?? '').trim(),
      competencia,
      guiasManuaisTotal: total,
      guiasManuaisMotivo: motivo,
    });
  }

  return { linhas, erros };
}
