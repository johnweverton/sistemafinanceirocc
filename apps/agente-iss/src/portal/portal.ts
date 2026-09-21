// Driver do portal ISS Fortaleza (Story 13.2). Cada passo espera uma mudança CONCRETA de tela
// observada na gravação real de 2026-09-21 (não "sleep e torce"). Regras de ouro:
//   1. só LÊ o portal — nenhum clique em Escriturar/Reabrir/Exportar/Emitir (seletores só
//      apontam para Pesquisar, Selecionar, Sim, Consultar e Visualizar);
//   2. nunca devolve valor sem as duas asserções R1: inscrição atual = empresa pedida, e
//      competência exibida = competência pedida;
//   3. o que não foi observado no portal real vira ERRO com snapshot, nunca ação às cegas
//      (caso do comunicado oficial — ver `ErroComunicadoPendente`).
import type { Page, Locator } from 'playwright';
import { S, URL_LOGIN, URL_HOME, HOST_IDP } from './seletores';
import {
  ErroExtracao,
  competenciaFechada,
  extrairSomatorioServicosPrestados,
  lerInscricaoAtual,
  linhaDaCompetencia,
  mesmaInscricao,
  somenteDigitos,
} from '../extracao/extracao';
import { competenciaPortal, dataCompetenciaPortal } from '../competencia';

export class ErroLogin extends Error {}
/** Empresa não aparece no perfil MASTER (outro município, sem vínculo) → `nao_encontrado`. */
export class ErroEmpresaNaoEncontrada extends Error {}
/**
 * O portal abriu um comunicado oficial ("Visualizar Mensagens") que exige Dar Ciência. O fluxo
 * de ciência (decisão G2) ainda não foi gravado no portal real — até lá, a empresa fica como
 * `erro` com snapshot, e o operador dá a ciência manualmente uma vez.
 */
export class ErroComunicadoPendente extends Error {}

export interface EmpresaSelecionada {
  inscricao: string;
  razaoSocial: string;
}

export type LeituraCompetencia =
  | { tipo: 'sem_escrituracao' }
  | {
      tipo: 'capturado';
      valor: number;
      quantidade: number;
      situacao: string;
      fechada: boolean | null;
    };

export interface Diagnostico {
  /** Salva HTML + print da tela atual (com o CPF do login removido). */
  snapshot(page: Page, nome: string): Promise<string | null>;
  log(msg: string): void;
  /** Modo --reconhecer: snapshot a cada passo. */
  reconhecer: boolean;
}

const TIMEOUT_TELA = 60_000;

async function assentar(page: Page): Promise<void> {
  // Rede quieta = requisição A4J (AJAX do RichFaces) terminou. Nunca é a única espera: cada
  // passo confere em seguida o elemento que a resposta deveria ter produzido.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

async function visivel(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

export class PortalIss {
  constructor(
    private readonly page: Page,
    private readonly diag: Diagnostico,
  ) {}

  private async passo(nome: string): Promise<void> {
    if (this.diag.reconhecer) await this.diag.snapshot(this.page, nome);
  }

  sessaoPerdida(): boolean {
    const url = this.page.url();
    return url.includes(HOST_IDP) || url.includes('/grpfor/login.seam') || url === 'about:blank';
  }

  // -------------------------------------------------------------------------------- login
  async login(cpf: string, senha: string): Promise<void> {
    const p = this.page;
    this.diag.log('Abrindo o portal e fazendo login…');
    await p.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    await p.locator(S.login.botaoFazerLogin).click();
    await p.locator(S.login.usuario).waitFor({ state: 'visible', timeout: TIMEOUT_TELA });
    await p.locator(S.login.usuario).fill(cpf);
    await p.locator(S.login.senha).fill(senha);
    await p.locator(S.login.entrar).click();

    // Ou volta ao ISS logado, ou o Keycloak mostra o erro. Uma tentativa só: repetir senha
    // errada pode bloquear o usuário MASTER da CEO.
    const resultado = await Promise.race([
      p.waitForURL((u) => u.host === 'iss.fortaleza.ce.gov.br' && !u.pathname.includes('login'), { timeout: TIMEOUT_TELA })
        .then(() => 'ok' as const),
      p.locator(S.login.erro).waitFor({ state: 'visible', timeout: TIMEOUT_TELA }).then(() => 'erro' as const),
    ]);
    if (resultado === 'erro') {
      const msg = (await p.locator(S.login.erro).innerText().catch(() => '')).trim();
      throw new ErroLogin(`Login recusado pelo portal: ${msg || 'sem mensagem'}. Confira ISS_CPF/ISS_SENHA.`);
    }
    await assentar(p);
    await this.passo('apos-login');
    this.diag.log('Login OK.');
  }

  // ------------------------------------------------------------------- seleção da empresa
  private async inscricaoAtual(): Promise<EmpresaSelecionada | null> {
    // Chamado também DURANTE a navegação da troca de inscrição: contexto destruído = "ainda não".
    try {
      const loc = this.page.locator(S.cabecalho.inscricaoAtual).first();
      if (!(await loc.count())) return null;
      return lerInscricaoAtual(await loc.innerText({ timeout: 2_000 }));
    } catch {
      return null;
    }
  }

  private async abrirModalInscricao(): Promise<void> {
    const tabela = this.page.locator(S.inscricao.tabela);
    if (await visivel(tabela)) return; // logo após o login o portal já abre o modal sozinho
    await this.page.locator(S.cabecalho.botaoTrocarInscricao).first().click();
    await tabela.waitFor({ state: 'visible', timeout: TIMEOUT_TELA });
    await assentar(this.page);
  }

  private async procurarLinhaNaPagina(documento: string): Promise<Locator | null> {
    const linhas = this.page.locator(S.inscricao.linhas);
    const n = await linhas.count();
    for (let i = 0; i < n; i += 1) {
      const linha = linhas.nth(i);
      const doc = await linha.locator(S.inscricao.linkDocumento).innerText().catch(() => '');
      if (somenteDigitos(doc) === documento) return linha;
    }
    return null;
  }

  private async pesquisar(documento: string | null): Promise<void> {
    const p = this.page;
    if (documento) {
      await p.locator(documento.length === 14 ? S.inscricao.radioCnpj : S.inscricao.radioCpf).check();
      await assentar(p); // a troca de rádio re-renderiza o campo e reaplica a máscara
    }
    const campo = p.locator(S.inscricao.campoPesquisa);
    await campo.click(); // onfocus do portal aplica a máscara (com AJAX)
    await assentar(p);
    await campo.fill('');
    if (documento) await campo.pressSequentially(documento, { delay: 40 }); // máscara precisa de teclas
    await p.locator(S.inscricao.botaoPesquisar).click();
    await assentar(p);
    await p.locator(S.inscricao.tabela).waitFor({ state: 'visible', timeout: TIMEOUT_TELA });
  }

  /**
   * Seleciona a empresa pelo CPF/CNPJ. Caminho principal: pesquisa pelo documento (rádio
   * CNPJ/CPF, como no processo manual). Se a pesquisa não trouxer a linha, cai para a lista
   * completa e percorre as páginas do paginador — mais lento, mas não depende do filtro.
   */
  async selecionarEmpresa(documento: string): Promise<EmpresaSelecionada> {
    const p = this.page;
    await this.abrirModalInscricao();
    await this.pesquisar(documento);
    await this.passo(`pesquisa-${documento}`);

    let linha = await this.procurarLinhaNaPagina(documento);
    if (!linha) {
      this.diag.log('  pesquisa não trouxe a empresa — percorrendo a lista completa');
      await this.pesquisar(null);
      for (let pagina = 1; !linha && pagina <= 30; pagina += 1) {
        linha = await this.procurarLinhaNaPagina(documento);
        if (linha) break;
        const proxima = p.locator(S.inscricao.proximaPagina).first();
        if (!(await proxima.count())) break;
        const antes = await p.locator(S.inscricao.linhas).first().innerText().catch(() => '');
        await proxima.click();
        await assentar(p);
        await p
          .waitForFunction(
            ({ sel, antes: a }) => (document.querySelector(sel) as HTMLElement | null)?.innerText !== a,
            { sel: S.inscricao.linhas, antes },
            { timeout: TIMEOUT_TELA },
          )
          .catch(() => undefined);
      }
    }
    if (!linha) throw new ErroEmpresaNaoEncontrada('CPF/CNPJ não aparece na lista de inscrições do perfil MASTER');

    const inscricaoLista = (await linha.locator(S.inscricao.linkInscricao).innerText()).trim();
    const nomeLista = (await linha.locator(S.inscricao.linkNome).innerText()).trim();

    await linha.locator(S.inscricao.linkSelecionar).click();
    // Com empresa já selecionada, o portal pergunta "A operação atual será abortada…" → Sim.
    // Sem empresa (logo após o login), vai direto. Espera um dos dois desfechos.
    const sim = p.locator(S.inscricao.confirmarSim);
    const prazo = Date.now() + TIMEOUT_TELA;
    let confirmou = false;
    for (;;) {
      if (!confirmou && (await visivel(sim))) {
        await sim.click();
        confirmou = true;
      }
      const atual = await this.inscricaoAtual();
      if (atual && mesmaInscricao(atual.inscricao, inscricaoLista) && !(await visivel(p.locator(S.inscricao.tabela)))) {
        break;
      }
      if (Date.now() > prazo) {
        throw new Error(`Troca de inscrição não concluiu (esperado ${inscricaoLista} ${nomeLista})`);
      }
      await p.waitForTimeout(400);
    }
    await assentar(p);
    await this.garantirSemComunicado();

    // R1 (1ª verificação): o cabeçalho diz que estamos na empresa pedida.
    const atual = await this.inscricaoAtual();
    if (!atual || !mesmaInscricao(atual.inscricao, inscricaoLista)) {
      throw new Error(`Inscrição atual (${atual?.inscricao ?? '?'}) difere da selecionada (${inscricaoLista})`);
    }
    await this.passo(`empresa-${documento}`);
    return { inscricao: inscricaoLista, razaoSocial: atual.razaoSocial || nomeLista };
  }

  private async garantirSemComunicado(): Promise<void> {
    const cabecalhos = this.page.locator(S.cabecalhoModal);
    const n = await cabecalhos.count();
    for (let i = 0; i < n; i += 1) {
      const c = cabecalhos.nth(i);
      if ((await visivel(c)) && /mensage/i.test(await c.innerText().catch(() => ''))) {
        await this.diag.snapshot(this.page, 'comunicado-pendente');
        throw new ErroComunicadoPendente(
          'Comunicado oficial pendente de "Dar Ciência" nesta empresa — ciência automática ainda não validada ' +
            'no portal real. Dê a ciência manualmente uma vez (tela salva em snapshots/) e rode de novo.',
        );
      }
    }
  }

  // ----------------------------------------------------------------- leitura da competência
  private async abrirManterEscrituracao(): Promise<void> {
    const p = this.page;
    await p.locator(S.menu.grupoEscrituracao, { hasText: /^\s*Escrituração\s*$/ }).first().click();
    await p.locator(S.menu.itensEscrituracao, { hasText: S.menu.textoManterEscrituracao }).first().click();
    await p.locator(S.escrituracao.botaoConsultar).waitFor({ state: 'visible', timeout: TIMEOUT_TELA });
    await assentar(p);
  }

  async lerCompetencia(competencia: string): Promise<LeituraCompetencia> {
    const p = this.page;
    const alvo = competenciaPortal(competencia); // '08/2026'

    await this.abrirManterEscrituracao();
    await this.passo('manter-escrituracao');

    // Filtro De/Até: o calendário RichFaces envia o campo oculto `…InputDate` ('MM/AAAA').
    // Marca o documento atual para saber quando o POST do Consultar trouxe a página nova.
    await p.evaluate(
      ({ de, ate, valor }) => {
        for (const sel of [de, ate]) {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (!el) throw new Error(`campo de competência não encontrado: ${sel}`);
          el.value = valor;
        }
        (window as unknown as { __agenteIss?: boolean }).__agenteIss = true;
      },
      { de: S.escrituracao.valorDe, ate: S.escrituracao.valorAte, valor: alvo },
    );
    await p.locator(S.escrituracao.botaoConsultar).click();
    await p.waitForFunction(() => !(window as unknown as { __agenteIss?: boolean }).__agenteIss, undefined, {
      timeout: TIMEOUT_TELA,
    });
    await p.locator(S.escrituracao.botaoConsultar).waitFor({ state: 'visible', timeout: TIMEOUT_TELA });
    await assentar(p);
    await this.passo(`consulta-${competencia}`);

    // O servidor re-renderiza o filtro com o que aceitou. Se não for o alvo, o filtro falhou —
    // e "não achei a linha" NÃO pode virar "sem escrituração".
    const aceito = await p.locator(S.escrituracao.valorDe).inputValue().catch(() => '');
    if (aceito !== alvo) {
      throw new Error(`Portal não aplicou o filtro de competência (pedido ${alvo}, ficou "${aceito}")`);
    }

    const linhas = await p.locator(S.escrituracao.competencias).evaluateAll((els) =>
      els.map((e) => ({ id: e.id, texto: (e.textContent ?? '').trim() })),
    );
    const achada = linhaDaCompetencia(
      linhas.map((l) => ({
        competencia: l.texto,
        situacao: '',
        indice: Number(/dataTable:(\d+):/.exec(l.id)?.[1] ?? -1),
      })),
      alvo,
    );
    if (!achada || achada.indice < 0) return { tipo: 'sem_escrituracao' };

    const situacao = (await p.locator(S.escrituracao.situacao(achada.indice)).innerText().catch(() => '')).trim();

    await p.locator(S.escrituracao.linkVisualizar(achada.indice)).click();
    await p.waitForURL(/visualizacaoEscrituracao/, { timeout: TIMEOUT_TELA });
    // A tela abre com "AGUARDE..." e carrega a aba Encerramento depois — espera a tabela.
    await p.locator(S.visualizacao.tabelaServicosPrestados).waitFor({ state: 'visible', timeout: 90_000 });
    await assentar(p);
    await this.passo(`visualizacao-${competencia}`);

    // R1 (2ª verificação): a tela é da competência pedida.
    const dataComp = await p.locator(S.visualizacao.dataCompetencia).inputValue().catch(() => '');
    if (dataComp !== dataCompetenciaPortal(competencia)) {
      throw new Error(`Visualização aberta na competência errada (esperado ${dataCompetenciaPortal(competencia)}, veio "${dataComp}")`);
    }

    const cabecalho = await p.locator(S.visualizacao.cabecalhoServicosPrestados).allInnerTexts();
    const rodape = await p.locator(S.visualizacao.rodapeServicosPrestados).allInnerTexts();
    const { valor, quantidade } = extrairSomatorioServicosPrestados({ cabecalho, rodape });
    return { tipo: 'capturado', valor, quantidade, situacao, fechada: competenciaFechada(situacao) };
  }

  /** Volta a um estado conhecido depois de um erro (ou relogin, se a sessão caiu). */
  async recuperar(cpf: string, senha: string): Promise<void> {
    await this.page.goto(URL_HOME, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await assentar(this.page);
    if (this.sessaoPerdida()) {
      this.diag.log('Sessão expirou — fazendo login de novo.');
      await this.login(cpf, senha);
    }
  }
}

export { ErroExtracao };
