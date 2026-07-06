// Barrel do Engine (motor de contagem e preço). Porte de motor_guias_v2.py.
// Funções puras, sem I/O. Testado contra os casos reais do PRD §12.
export { checar, LIMIAR_VARIACAO } from './conferencia';
export { classesDoMedico, valorDaFaixa, TABELA_PRECO_PADRAO } from './precos';
export { processarMedico } from './processar-medico';
export {
  itensValidos,
  chaveAtendimento,
  contarGuiasProducao,
  detectarModoProducao,
  consolidarProducao,
} from './contagem-producao';
