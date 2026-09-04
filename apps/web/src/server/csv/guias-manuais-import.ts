// Importação da planilha de GUIAS CONFERIDAS MANUALMENTE (migration 0058, aprovado 2026-09-03;
// estendida para colunas por CLASSE no achado 2026-09-04). Diferente dos outros 3 importadores
// (médicos/empresas/clientes de contabilidade), este NÃO grava nada: ele só RESOLVE cada linha da
// planilha contra o cadastro (CPF → médico) e devolve o que o operador precisa conferir na tela
// antes de disparar a execução. O número só vira dado persistido quando ele confirma o disparo,
// dentro de `execucao_selecoes`.
//
// Por isso não reaproveita `processarLinhas` (planilha-import.ts), que é um loop
// linha→schema→criar/atualizar no banco; aqui reaproveita o parsing (`parseCsv`/`parseExcel`) e o
// formato de erro por linha (`ErroLinha`), que é o que de fato se repete entre os importadores.
//
// Regra de ouro (PRD §2, nunca chuta): toda linha que não resolve com certeza vira ERRO EXPLÍCITO
// de linha — nunca é ignorada em silêncio, nunca "escolhe o mais parecido". É dinheiro real.
import type { Medico } from '@cobranca/shared';
import { parseCsv, parseExcel, normalizarNome, type ErroLinha } from './planilha-import';
import { isPediatra, isAngiologista } from '../engine/contagem-producao';

export { parseCsv, parseExcel };

/** Colunas esperadas — ver o template público `public/templates/guias-manuais-modelo.csv`.
 *  As 4 colunas de total (`total_guias`/`total_consultas`/`total_imobilizacoes`/
 *  `total_outros_hospitais`) são cada uma OPCIONAL por linha — o operador preenche só a(s)
 *  classe(s) que conferiu à mão para aquele médico (achado 2026-09-04: são tabelas de preço
 *  DIFERENTES, um total agregado só misturaria valores de classes diferentes num número). Pelo
 *  menos 1 das 4 precisa vir preenchida, senão a linha não teria efeito nenhum. */
export const COLUNAS_GUIAS_MANUAIS = [
  'cpf',
  'nome',
  'competencia',
  'total_guias',
  'total_consultas',
  'total_imobilizacoes',
  'total_outros_hospitais',
  'motivo',
] as const;

/** Uma linha da planilha já casada com um médico do cadastro. Cada campo `guiasManuais*` é
 *  independente e opcional — `undefined` = aquela classe continua na contagem automática
 *  (execução mista é o caso normal, mesmo espírito de sempre); presente = override manual só
 *  daquela classe. */
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
  /** Override do lote PRINCIPAL (guias normais, tabela HAPVIDA_CRED/NAO_CRED). */
  guiasManuaisTotal?: number;
  /** Override do componente de CONSULTAS ambulatoriais — só faz sentido pra médico Pediatra. */
  guiasManuaisConsultas?: number;
  /** Override do lote separado de IMOBILIZACOES — só faz sentido pra médico com essa classe. */
  guiasManuaisImobilizacoes?: number;
  /** Override do lote separado de OUTROS_HOSPITAIS — só faz sentido pra médico com essa classe. */
  guiasManuaisOutrosHospitais?: number;
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
 * Normaliza competência para `AAAA-MM`, aceitando os formatos:
 *  - `AAAA-MM` (canônico, sem conversão)
 *  - `DD/MM/AAAA` (ex.: `01/08/2026` → `2026-08`) — formato comum em CSVs brasileiros
 *  - `MM/AAAA` (ex.: `08/2026` → `2026-08`)
 * Retorna a string original se não reconhecer nenhum formato (a validação downstream barrrará).
 */
export function normalizarCompetencia(valor: string): string {
  const s = valor.trim();
  // Já no formato canônico
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  // DD/MM/AAAA — o dia é descartado; só mês e ano importam
  const ddMmAaaa = s.match(/^(\d{1,2})\/(\d{2})\/(\d{4})$/);
  if (ddMmAaaa) return `${ddMmAaaa[3]}-${ddMmAaaa[2]!.padStart(2, '0')}`;
  // MM/AAAA
  const mmAaaa = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmAaaa) return `${mmAaaa[2]}-${mmAaaa[1]!.padStart(2, '0')}`;
  return s;
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
 *  - alguma das 4 colunas de total preenchida com valor não inteiro/negativo;
 *  - NENHUMA das 4 colunas de total preenchida (linha sem efeito nenhum);
 *  - `total_consultas` preenchido para médico que não é Pediatra, `total_imobilizacoes`/
 *    `total_outros_hospitais` preenchido para médico sem essa classe no cadastro — a coluna
 *    nunca teria efeito, melhor barrar do que deixar o operador achar que conferiu algo que o
 *    motor nunca usa;
 *  - QUALQUER coluna preenchida para médico Angiologista — essa especialidade não tem lote
 *    principal (produção vem de Cateter/Fístula/Angiografia/Carta de Rede) e não passa por este
 *    fluxo de planilha;
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

  // Índice secundário por NOME NORMALIZADO — usado como FALLBACK quando o CPF da linha não bate
  // com nenhum médico do cadastro (ex.: médico cadastrado sem CPF, ou CPF diferente do que o
  // operador tem na planilha). Match por nome é ambíguo (homônimos), então:
  //  1. Só entra quando CPF realmente não encontra;
  //  2. Match com mais de 1 resultado vira erro (impossível escolher);
  //  3. A linha casada por nome recebe aviso explícito no preview — nunca silencioso.
  const medicosPorNome = new Map<string, Medico[]>();
  for (const m of medicos) {
    const nomeNorm = normalizarNome(m.nome);
    const lista = medicosPorNome.get(nomeNorm) ?? [];
    lista.push(m);
    medicosPorNome.set(nomeNorm, lista);
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

    let medico = medicosPorCpf.get(cpf);
    let casadoPorNome = false;
    if (!medico) {
      // Fallback: tenta casar pelo nome normalizado (match parcial tolerante a acentos/caixa)
      const nomeNorm = normalizarNome((row.nome ?? '').trim());
      if (nomeNorm) {
        const candidatos = medicosPorNome.get(nomeNorm) ?? [];
        if (candidatos.length === 1 && candidatos[0]) {
          medico = candidatos[0];
          casadoPorNome = true;
        } else if (candidatos.length > 1) {
          erro(
            `CPF ${cpf} não encontrado e o nome "${(row.nome ?? '').trim()}" casou com ${candidatos.length} médicos no cadastro — informe o CPF correto para desambiguar`,
          );
          continue;
        }
      }
      if (!medico) {
        erro(`CPF ${cpf} não encontrado no cadastro de médicos (e o nome "${(row.nome ?? '').trim()}" também não casou)`);
        continue;
      }
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

    const competenciaBruta = (row.competencia ?? '').trim();
    const competencia = normalizarCompetencia(competenciaBruta);
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      erro(`Competência "${competenciaBruta}" inválida — use o formato AAAA-MM ou DD/MM/AAAA (ex.: ${competenciaExecucao})`);
      continue;
    }
    if (competencia !== competenciaExecucao) {
      erro(
        `Competência da planilha (${competencia}) é diferente da competência desta emissão ` +
          `(${competenciaExecucao})`,
      );
      continue;
    }

    // Cada coluna de total é independente e opcional — em branco = aquela classe continua na
    // contagem automática. `null` (não `undefined`) marca "coluna com problema" pra sair da
    // linha inteira sem confundir com "coluna legitimamente em branco".
    let colunaInvalida = false;
    const parseTotalOpcional = (bruto: string | undefined, coluna: string): number | undefined => {
      const texto = (bruto ?? '').trim();
      if (texto === '') return undefined;
      const n = Number(texto);
      if (!Number.isInteger(n) || n < 0) {
        erro(`${coluna} "${texto}" inválido: informe um número inteiro maior ou igual a 0, ou deixe em branco`);
        colunaInvalida = true;
      }
      return n;
    };

    const guiasManuaisTotal = parseTotalOpcional(row.total_guias, 'total_guias');
    const guiasManuaisConsultas = parseTotalOpcional(row.total_consultas, 'total_consultas');
    const guiasManuaisImobilizacoes = parseTotalOpcional(row.total_imobilizacoes, 'total_imobilizacoes');
    const guiasManuaisOutrosHospitais = parseTotalOpcional(row.total_outros_hospitais, 'total_outros_hospitais');
    if (colunaInvalida) continue;

    if (
      guiasManuaisTotal === undefined &&
      guiasManuaisConsultas === undefined &&
      guiasManuaisImobilizacoes === undefined &&
      guiasManuaisOutrosHospitais === undefined
    ) {
      erro(
        'Nenhuma coluna de total preenchida (total_guias/total_consultas/total_imobilizacoes/' +
          'total_outros_hospitais) — a linha não teria efeito, informe pelo menos uma',
      );
      continue;
    }

    // Angiologista não tem lote principal (produção vem de Cateter/Fístula/Angiografia/Carta de
    // Rede) — nenhuma das 4 colunas se aplica a essa especialidade, barra ANTES das checagens
    // específicas abaixo pra dar uma mensagem só, mais clara que 4 erros por coluna.
    if (isAngiologista(medico.especialidade)) {
      erro(
        `${medico.nome} (CPF ${cpf}) é Angiologista — esta planilha não é suportada para essa ` +
          'especialidade (produção vem de Cateter/Fístula/Angiografia/Carta de Rede, sem lote ' +
          'principal); usar o modo "Por médico" para conferir manualmente',
      );
      continue;
    }
    if (guiasManuaisConsultas !== undefined && !isPediatra(medico.especialidade)) {
      erro(`${medico.nome} (CPF ${cpf}) não é Pediatra — coluna total_consultas não se aplica a este médico`);
      continue;
    }
    if (guiasManuaisImobilizacoes !== undefined && !medico.fazImobilizacoes) {
      erro(
        `${medico.nome} (CPF ${cpf}) não tem Imobilizações marcado no cadastro — coluna ` +
          'total_imobilizacoes não se aplica a este médico',
      );
      continue;
    }
    if (guiasManuaisOutrosHospitais !== undefined && !medico.fazOutrosHospitais) {
      erro(
        `${medico.nome} (CPF ${cpf}) não tem Outros Hospitais marcado no cadastro — coluna ` +
          'total_outros_hospitais não se aplica a este médico',
      );
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
      cpf: normalizarCpf(medico.cpf) || cpf,
      nomePlanilha: casadoPorNome
        ? `${(row.nome ?? '').trim()} ⚠️ casado por NOME (CPF ${cpf} não encontrado — confirme que é o médico correto)`
        : (row.nome ?? '').trim(),
      competencia,
      ...(guiasManuaisTotal !== undefined ? { guiasManuaisTotal } : {}),
      ...(guiasManuaisConsultas !== undefined ? { guiasManuaisConsultas } : {}),
      ...(guiasManuaisImobilizacoes !== undefined ? { guiasManuaisImobilizacoes } : {}),
      ...(guiasManuaisOutrosHospitais !== undefined ? { guiasManuaisOutrosHospitais } : {}),
      guiasManuaisMotivo: motivo,
    });
  }

  return { linhas, erros };
}
