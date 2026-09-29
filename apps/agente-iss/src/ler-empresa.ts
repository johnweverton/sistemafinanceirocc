// Leitura de UMA empresa no portal, já logado — o pedaço que o agente local (executar-competencia)
// e a busca na nuvem (apps/web, iss-nuvem) têm em comum. Duas tentativas só quando a sessão caiu
// no meio; senha recusada (`ErroLogin`) sobe para quem chamou parar tudo, sem arriscar bloquear o
// usuário MASTER. Não toca em disco: snapshot é injetado por quem chama.
import type { AlvoIss, NovaCapturaIss } from '@cobranca/shared';
import { redigirCpf } from './diagnostico';
import {
  ErroComunicadoPendente,
  ErroEmpresaNaoEncontrada,
  ErroLogin,
  type EmpresaSelecionada,
  type LeituraCompetencia,
} from './portal/portal';

/** O que a leitura usa do portal — o `PortalIss` real, ou um dublê nos testes. */
export interface PortalParaExecucao {
  login(cpf: string, senha: string): Promise<void>;
  sessaoPerdida(): boolean;
  recuperar(cpf: string, senha: string): Promise<void>;
  selecionarEmpresa(documento: string): Promise<EmpresaSelecionada>;
  lerCompetencia(competencia: string): Promise<LeituraCompetencia>;
}

export interface OpcoesLerEmpresa {
  portal: PortalParaExecucao;
  alvo: AlvoIss;
  competencia: string;
  cpf: string;
  senha: string;
  agora(): Date;
  log(msg: string): void;
  /** Tela do erro (agente local: HTML + print em snapshots/). Não chamado em comunicado pendente. */
  snapshotErro?(documento: string): Promise<unknown>;
}

export function capturaBase(alvo: AlvoIss, agora: Date): Omit<NovaCapturaIss, 'status'> {
  return {
    clienteContabilidadeId: alvo.clienteContabilidadeId,
    valorServicosPrestados: null,
    quantidadeNotas: null,
    situacaoIss: null,
    competenciaFechada: null,
    inscricaoMunicipal: null,
    razaoSocialIss: null,
    mensagemErro: null,
    capturadoEm: agora.toISOString(),
  };
}

/** Lê a empresa e devolve a captura. Só LANÇA `ErroLogin` (o resto vira captura `erro`). */
export async function lerEmpresa(o: OpcoesLerEmpresa): Promise<NovaCapturaIss> {
  const { portal, alvo, competencia, cpf, senha } = o;
  let captura: NovaCapturaIss | null = null;
  for (let tentativa = 1; tentativa <= 2 && !captura; tentativa += 1) {
    try {
      if (portal.sessaoPerdida()) await portal.recuperar(cpf, senha);
      const empresa = await portal.selecionarEmpresa(alvo.documento);
      const leitura = await portal.lerCompetencia(competencia);
      const base = {
        ...capturaBase(alvo, o.agora()),
        inscricaoMunicipal: empresa.inscricao,
        razaoSocialIss: empresa.razaoSocial,
      };
      captura =
        leitura.tipo === 'capturado'
          ? {
              ...base,
              status: 'capturado',
              valorServicosPrestados: leitura.valor,
              quantidadeNotas: leitura.quantidade,
              situacaoIss: leitura.situacao || null,
              competenciaFechada: leitura.fechada,
            }
          : { ...base, status: 'sem_escrituracao' };
    } catch (e) {
      if (e instanceof ErroLogin) throw e; // senha errada: parar tudo (não arriscar bloqueio)
      if (e instanceof ErroEmpresaNaoEncontrada) {
        captura = { ...capturaBase(alvo, o.agora()), status: 'nao_encontrado', mensagemErro: e.message };
        break;
      }
      const sessaoCaiu = portal.sessaoPerdida();
      if (sessaoCaiu && tentativa === 1) {
        o.log('  sessão caiu no meio — relogando e tentando esta empresa de novo');
        await portal.recuperar(cpf, senha);
        continue;
      }
      const msg = redigirCpf((e as Error).message, cpf).slice(0, 900);
      if (!(e instanceof ErroComunicadoPendente)) await o.snapshotErro?.(alvo.documento);
      captura = { ...capturaBase(alvo, o.agora()), status: 'erro', mensagemErro: msg };
      await portal.recuperar(cpf, senha).catch(() => undefined);
    }
  }
  return captura ?? { ...capturaBase(alvo, o.agora()), status: 'erro', mensagemErro: 'Sem resultado' };
}
