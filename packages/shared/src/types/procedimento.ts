// Procedimento — tipo de transporte, NÃO persistido (PRD §6.2, §9).
// Representa uma linha vinda da API externa da Carmem (contrato PRD §6.4).
// Vive só em memória durante a execução de um médico.

export type PapelMedico = 'M' | 'A1' | 'A2';

export interface Procedimento {
  cpfMedico: string; // 11 dígitos sem pontuação — chave que cruza com o cadastro
  numeroAtendimento: string; // a cirurgia/internação real
  senhaProcedimento: string; // uma por procedimento
  dataEmissao: string; // AAAA-MM-DD — usada para filtrar a competência
  dataProcedimento: string; // AAAA-MM-DD — usada no agrupamento de contagem (PRD §5.2)
  tipo: PapelMedico; // papel do médico — preservado p/ rastreabilidade, NÃO filtra contagem (PRD §5.4)
  descricaoProcedimento: string | null;
  codigoProcedimento: string | null;
  valor: number | null;
  localAtendimento: string | null;
  plano: string | null;
}
