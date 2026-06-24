// Domínio: Médico — fonte única de verdade dos parâmetros de faturamento.
// Derivado da arquitetura (Data Models) e do PRD §5.1 / §7.

export type StatusHapvida = 'credenciado' | 'nao_credenciado' | 'nenhum';
export type ModoMudancaData = 'sim' | 'nao';

export interface Medico {
  id: string;
  cpf: string; // 11 dígitos, sem pontuação — chave de cruzamento com a API externa
  nome: string;
  especialidade: string | null;
  statusHapvida: StatusHapvida;
  fazOutrosHospitais: boolean;
  fazImobilizacoes: boolean;
  modoMudancaData: ModoMudancaData; // trava de conferência, NÃO entra no cálculo (PRD §5.3)
  colaboradorResponsavel: string | null;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
}

// TIPO é derivado, nunca persistido como campo editável (PRD §5.1, §8.2).
export type TipoMedico = 1 | 2 | 3 | 4 | 5;

/**
 * Calcula o TIPO do médico a partir de status_hapvida + faz_outros_hospitais.
 * PRD §5.1:
 *   TIPO 1: não credenciado Hapvida (sem outros hospitais)
 *   TIPO 2: credenciado Hapvida (sem outros hospitais)
 *   TIPO 3: somente outros hospitais (sem Hapvida)
 *   TIPO 4: credenciado Hapvida + outros hospitais
 *   TIPO 5: não credenciado Hapvida + outros hospitais
 * Combinação inválida (nenhum status Hapvida e sem outros hospitais) lança erro (PRD §8.2).
 */
export function tipoDoMedico(
  m: Pick<Medico, 'statusHapvida' | 'fazOutrosHospitais'>,
): TipoMedico {
  const { statusHapvida: s, fazOutrosHospitais: outros } = m;
  if (s === 'nenhum' && !outros) {
    throw new Error('Combinação inválida: sem Hapvida e sem outros hospitais');
  }
  if (s === 'nao_credenciado' && !outros) return 1;
  if (s === 'credenciado' && !outros) return 2;
  if (s === 'nenhum' && outros) return 3;
  if (s === 'credenciado' && outros) return 4;
  return 5; // nao_credenciado && outros
}

/** Combinação válida de status_hapvida + faz_outros_hospitais (espelha a CHECK do banco). */
export function combinacaoClasseValida(
  m: Pick<Medico, 'statusHapvida' | 'fazOutrosHospitais'>,
): boolean {
  return !(m.statusHapvida === 'nenhum' && !m.fazOutrosHospitais);
}

export interface MedicoHistorico {
  id: string;
  medicoId: string;
  campoAlterado: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  alteradoPor: string; // user id (profiles.id)
  motivo: string | null;
  alteradoEm: string;
}
