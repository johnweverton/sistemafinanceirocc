// Barrel do Engine (motor de contagem e preço). Porte de motor_guias_v2.py.
// Funções puras, sem I/O. Testado contra os casos reais do PRD §12.
export { checar, LIMIAR_VARIACAO } from './conferencia';
export { classesDoMedico, valorDaFaixa, tabelaSemExcedentePorGuia, TABELA_PRECO_PADRAO, VALOR_CONSULTA_PEDIATRIA_PADRAO } from './precos';
export { processarMedico } from './processar-medico';
export {
  itensValidos,
  chaveAtendimento,
  contarGuiasProducao,
  detectarModoProducao,
  consolidarProducao,
  contarConsultasProducao,
  isPediatra,
  isUrologista,
  isGinecologista,
  isOrtopedista,
  isAngiologista,
  usaRegra3x1,
  CODIGOS_EXCECAO_UROLOGISTA,
  CODIGOS_EXCECAO_ANGIOGRAFIA,
} from './contagem-producao';
