// Resolução do PAGADOR (médico/empresa/cliente contábil) de um execucao_resultado — extraído de
// emitir-boleto.ts (Épico 13, lembrete de vencimento) para ser reusado pelo cron de lembrete SEM
// herdar as validações de emissão (status='ok', valor mínimo), que não fazem sentido para um
// boleto que já foi emitido com sucesso.
//
// NÃO valida cobrancaMinimaEmissao — quem usar isto para EMITIR (validarResultadoParaEmissao)
// aplica esse guard depois de chamar esta função. O lembrete de vencimento tolera cobrança
// incompleta (ex.: só WhatsApp, sem e-mail) — ver DadosCobranca.cobrancaCompleta().
import type { DadosCobranca, CondicoesCobranca, ContaEmissora } from '@cobranca/shared';
import { ApiError } from '@/lib/api-error';
import type { PagadorNomenclatura } from '@/server/gateway/mensagem-boleto';
import { buscarMedico } from '@/server/repositories/medico-repository';
import { buscarEmpresa } from '@/server/repositories/empresa-repository';
import { buscarClienteContabilidade } from '@/server/repositories/cliente-contabilidade-repository';

export interface ResultadoParaResolverPagador {
  empresa_id?: string | null;
  cliente_contabilidade_id?: string | null;
  medico_id: string | null;
}

export interface PagadorResolvido {
  pagadorNomenclatura: PagadorNomenclatura;
  cobranca: DadosCobranca | null; // pode ser null (médico sem cobranca preenchida)
  condicoesPagador: CondicoesCobranca | null;
  contaEmissora: ContaEmissora;
}

/**
 * Resolve o pagador (médico OU empresa OU cliente contábil, mutuamente exclusivos —
 * CHECK chk_execucao_resultados_exclusao_mutua, migration 0032) de um resultado de execução.
 * Lança ApiError 404 nomeado se o vínculo apontar para um registro inexistente, e 422
 * SEM_MEDICO se o resultado não tiver nenhum dos três vínculos.
 */
export async function resolverPagadorDoResultado(
  resultado: ResultadoParaResolverPagador,
): Promise<PagadorResolvido> {
  if (resultado.empresa_id) {
    const empresa = await buscarEmpresa(resultado.empresa_id);
    if (!empresa) {
      throw new ApiError(404, 'Empresa do resultado não encontrada', 'EMPRESA_NAO_ENCONTRADA');
    }
    return {
      pagadorNomenclatura: 'empresa',
      cobranca: empresa.cobranca,
      condicoesPagador: empresa.condicoes,
      contaEmissora: empresa.contaEmissora,
    };
  }
  if (resultado.cliente_contabilidade_id) {
    const cliente = await buscarClienteContabilidade(resultado.cliente_contabilidade_id);
    if (!cliente) {
      throw new ApiError(404, 'Cliente contábil do resultado não encontrado', 'CLIENTE_CONTABILIDADE_NAO_ENCONTRADO');
    }
    return {
      pagadorNomenclatura: 'cliente contábil',
      cobranca: cliente.cobranca,
      condicoesPagador: cliente.condicoes,
      contaEmissora: cliente.contaEmissora,
    };
  }
  if (resultado.medico_id) {
    const medico = await buscarMedico(resultado.medico_id);
    if (!medico) {
      throw new ApiError(404, 'Médico do resultado não encontrado', 'MEDICO_NAO_ENCONTRADO');
    }
    return {
      pagadorNomenclatura: 'médico',
      cobranca: medico.cobranca ?? null,
      condicoesPagador: medico.condicoes ?? null,
      contaEmissora: medico.contaEmissora,
    };
  }
  throw new ApiError(422, 'Resultado sem médico, empresa nem cliente contábil vinculado. Não é possível cobrar', 'SEM_MEDICO');
}
