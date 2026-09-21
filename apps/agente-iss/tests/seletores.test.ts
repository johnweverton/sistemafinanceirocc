// @vitest-environment jsdom
// Prova que CADA seletor de src/portal/seletores.ts casa com o HTML REAL do portal (gravado em
// 2026-09-21 e anonimizado em tests/fixtures) — e que a extração sobre esse DOM dá o número certo.
// Se o portal mudar, gravar de novo (modo --reconhecer) e trocar o fixture: este teste aponta
// exatamente qual seletor deixou de casar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { S } from '../src/portal/seletores';
import {
  extrairSomatorioServicosPrestados,
  lerInscricaoAtual,
  mesmaInscricao,
  somenteDigitos,
} from '../src/extracao/extracao';

function carregar(nome: string): Document {
  const html = readFileSync(join(__dirname, 'fixtures', nome), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}
const texto = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const todos = (doc: Document, sel: string) => [...doc.querySelectorAll(sel)];

describe('login (Keycloak)', () => {
  const doc = carregar('login-keycloak-erro.html');
  it('campos, botão e mensagem de erro', () => {
    expect(doc.querySelector(S.login.usuario)).not.toBeNull();
    expect(doc.querySelector(S.login.senha)?.getAttribute('type')).toBe('password');
    expect(doc.querySelector(S.login.entrar)?.getAttribute('value')).toBe('Entrar');
    expect(texto(doc.querySelector(S.login.erro))).toMatch(/senha inválida/);
  });
});

describe('modal SELECIONE INSCRIÇÃO', () => {
  const doc = carregar('selecionar-inscricao.html');

  it('pesquisa: campo, rádios CPF/CNPJ e botão', () => {
    expect(doc.querySelector(S.inscricao.campoPesquisa)).not.toBeNull();
    expect(doc.querySelector(S.inscricao.radioCpf)?.getAttribute('value')).toBe('CPF');
    expect(doc.querySelector(S.inscricao.radioCnpj)?.getAttribute('value')).toBe('CNPJ');
    expect(doc.querySelector(S.inscricao.botaoPesquisar)?.getAttribute('value')).toBe('Pesquisar');
  });

  it('10 linhas por página, cada uma com os 4 links', () => {
    const linhas = todos(doc, S.inscricao.linhas);
    expect(linhas).toHaveLength(10);
    for (const l of linhas) {
      expect(l.querySelector(S.inscricao.linkSelecionar)?.getAttribute('title')).toBe('Selecionar');
      expect(somenteDigitos(texto(l.querySelector(S.inscricao.linkDocumento)))).toHaveLength(14);
      expect(texto(l.querySelector(S.inscricao.linkInscricao))).toMatch(/^\d{7}-\d$/);
      expect(texto(l.querySelector(S.inscricao.linkNome))).not.toBe('');
    }
  });

  it('acha a empresa pelo CNPJ só com dígitos', () => {
    const linha = todos(doc, S.inscricao.linhas).find(
      (l) => somenteDigitos(texto(l.querySelector(S.inscricao.linkDocumento))) === '11222333000181',
    );
    expect(texto(linha!.querySelector(S.inscricao.linkNome))).toBe('EMPRESA ALFA LTDA');
    expect(texto(linha!.querySelector(S.inscricao.linkInscricao))).toBe('0123456-7');
  });

  it('paginador: exatamente um botão "próxima" habilitado', () => {
    expect(todos(doc, S.inscricao.proximaPagina)).toHaveLength(1);
  });
});

describe('confirmação de troca de inscrição', () => {
  it('botão Sim', () => {
    const doc = carregar('confirmar-troca-inscricao.html');
    expect(texto(doc.querySelector(S.inscricao.confirmarSim))).toBe('Sim');
    expect(texto(doc.querySelector(S.cabecalhoModal))).toMatch(/Alterar Inscrição/i);
  });
});

describe('Manter Escrituração', () => {
  const doc = carregar('manter-escrituracao.html');

  it('cabeçalho com inscrição atual e botão de troca', () => {
    const atual = lerInscricaoAtual(texto(doc.querySelector(S.cabecalho.inscricaoAtual)));
    expect(atual).toEqual({ inscricao: '765432-1', razaoSocial: 'EMPRESA BETA LTDA' });
    expect(doc.querySelector(S.cabecalho.botaoTrocarInscricao)).not.toBeNull();
  });

  it('filtro De/Até (campos ocultos MM/AAAA) e Consultar', () => {
    expect((doc.querySelector(S.escrituracao.valorDe) as HTMLInputElement).value).toBe('09/2026');
    expect((doc.querySelector(S.escrituracao.valorAte) as HTMLInputElement).value).toBe('09/2026');
    expect(doc.querySelector(S.escrituracao.botaoConsultar)?.getAttribute('value')).toBe('Consultar');
  });

  it('linha da competência, situação e o link de VISUALIZAR (e só ele)', () => {
    const comps = todos(doc, S.escrituracao.competencias);
    expect(comps.map(texto)).toEqual(['09/2026']);
    expect(comps[0]!.id).toBe('manterEscrituracaoForm:dataTable:0:textoCompetencia');
    expect(texto(doc.querySelector(S.escrituracao.situacao(0)))).toBe('Aberta - Normal');
    const links = todos(doc, S.escrituracao.linkVisualizar(0));
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('title')).toBe('Visualizar Escrituração');
    expect(links[0]!.id).not.toMatch(/Escriturar|Reabrir/i); // nunca a ação de escrita
  });
});

describe('Visualização da escrituração (empresa com linha C — R$ 7.654,32 no fixture)', () => {
  const doc = carregar('visualizacao-escrituracao.html');

  it('competência no campo oculto dataCompentencia', () => {
    expect((doc.querySelector(S.visualizacao.dataCompetencia) as HTMLInputElement).value).toBe('01/09/2026');
  });

  it('extrai o Somatório de Serviços Prestados pelo thead/tfoot reais', () => {
    const cabecalho = todos(doc, S.visualizacao.cabecalhoServicosPrestados).map(texto);
    const rodape = todos(doc, S.visualizacao.rodapeServicosPrestados).map(texto);
    expect(extrairSomatorioServicosPrestados({ cabecalho, rodape })).toEqual({ valor: 7654.32, quantidade: 1 });
  });

  it('não confunde com "Serviços Tomados" (outra tabela com Somatório no mesmo bloco)', () => {
    expect(todos(doc, S.visualizacao.tabelaServicosPrestados)).toHaveLength(1);
    const cab = todos(doc, S.visualizacao.cabecalhoServicosPrestados).map(texto);
    expect(cab).toContain('Serviços Prestados');
    expect(cab).not.toContain('Serviços Tomados');
  });

  it('inscrição do cabeçalho (sem zero à esquerda) bate com a da lista (com zero)', () => {
    const atual = lerInscricaoAtual(texto(doc.querySelector(S.cabecalho.inscricaoAtual)))!;
    expect(atual.inscricao).toBe('123456-7');
    expect(mesmaInscricao(atual.inscricao, '0123456-7')).toBe(true);
  });
});
