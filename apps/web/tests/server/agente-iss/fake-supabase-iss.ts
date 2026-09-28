// Dublê em memória do cliente Supabase (PostgREST) para os testes das solicitações do ISS
// (Story 13.5). Mesmo espírito do mock de iss-captura-repository.test.ts, mas genérico o bastante
// para as rotas rodarem de ponta a ponta (rota → zod → repositório → "banco") sem banco real:
// cobre select/insert/update com eq/in/lt/order/limit/single/maybeSingle e reproduz as duas
// restrições que a lógica usa de verdade:
//   - o índice único parcial `uq_iss_solicitacoes_competencia_ativa` (0062) → erro 23505;
//   - a FK `iss_solicitacoes.execucao_id → iss_execucoes_agente(id)` → erro 23503;
//   - o índice único parcial `uq_iss_execucoes_agente_chave` (0062, QA 13.4/13.5) → erro 23505.
import { randomUUID } from 'node:crypto';

export type Linha = Record<string, unknown>;

export interface FakeBanco {
  tabelas: Record<string, Linha[]>;
  /** Chamado antes de cada operação — permite simular corrida (outro processo gravando no meio). */
  antesDe?: (op: Operacao, tabela: string) => void;
  /** Toda operação executada, para asserções ("não escreveu em X"). */
  log: { op: Operacao; tabela: string }[];
}

type Operacao = 'select' | 'insert' | 'update' | 'delete';
type Erro = { code?: string; message: string };
type Resultado = { data: unknown; error: Erro | null };

export function criarBanco(tabelas: Record<string, Linha[]> = {}): FakeBanco {
  return { tabelas: { iss_solicitacoes: [], iss_execucoes_agente: [], iss_capturas: [], ...tabelas }, log: [] };
}

const ATIVOS = ['pendente', 'em_andamento'];

function padroesDaTabela(tabela: string, agora: string): Linha {
  if (tabela === 'iss_solicitacoes') {
    return {
      id: randomUUID(),
      documentos: null,
      status: 'pendente',
      solicitado_em: agora,
      iniciado_em: null,
      finalizado_em: null,
      progresso_atual: null,
      progresso_total: null,
      execucao_id: null,
      mensagem_erro: null,
      maquina: null,
      heartbeat_em: null,
    };
  }
  return { id: randomUUID() };
}

function violacoes(banco: FakeBanco, tabela: string, linha: Linha): Erro | null {
  // QA 13.4/13.5: `uq_iss_execucoes_agente_chave` (0062) — mesma chave de idempotência duas vezes.
  if (tabela === 'iss_execucoes_agente') {
    const chave = linha.chave_idempotencia;
    const repetida =
      chave != null &&
      banco.tabelas.iss_execucoes_agente!.some((e) => e.id !== linha.id && e.chave_idempotencia === chave);
    return repetida
      ? { code: '23505', message: 'duplicate key value violates unique constraint "uq_iss_execucoes_agente_chave"' }
      : null;
  }
  if (tabela !== 'iss_solicitacoes') return null;
  if (ATIVOS.includes(String(linha.status))) {
    const outra = banco.tabelas.iss_solicitacoes!.find(
      (s) => s.id !== linha.id && s.competencia === linha.competencia && ATIVOS.includes(String(s.status)),
    );
    if (outra) {
      return {
        code: '23505',
        message: 'duplicate key value violates unique constraint "uq_iss_solicitacoes_competencia_ativa"',
      };
    }
  }
  if (linha.execucao_id && !banco.tabelas.iss_execucoes_agente!.some((e) => e.id === linha.execucao_id)) {
    return { code: '23503', message: 'insert or update violates foreign key constraint' };
  }
  return null;
}

class Consulta implements PromiseLike<Resultado> {
  private op: Operacao = 'select';
  private filtros: ((l: Linha) => boolean)[] = [];
  private ordem: { coluna: string; asc: boolean } | null = null;
  private limite: number | null = null;
  private payload: Linha | Linha[] | null = null;
  private modo: 'lista' | 'single' | 'maybeSingle' = 'lista';

  constructor(
    private readonly banco: FakeBanco,
    private readonly tabela: string,
  ) {}

  select(_colunas?: string) {
    return this; // em insert/update, só pede o "returning" — o dublê sempre devolve as linhas
  }
  insert(linhas: Linha | Linha[]) {
    this.op = 'insert';
    this.payload = linhas;
    return this;
  }
  update(campos: Linha) {
    this.op = 'update';
    this.payload = campos;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(coluna: string, valor: unknown) {
    this.filtros.push((l) => l[coluna] === valor);
    return this;
  }
  in(coluna: string, valores: unknown[]) {
    this.filtros.push((l) => valores.includes(l[coluna]));
    return this;
  }
  lt(coluna: string, valor: string) {
    this.filtros.push((l) => l[coluna] !== null && l[coluna] !== undefined && String(l[coluna]) < valor);
    return this;
  }
  order(coluna: string, opcoes: { ascending?: boolean } = {}) {
    this.ordem = { coluna, asc: opcoes.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  single() {
    this.modo = 'single';
    return this;
  }
  maybeSingle() {
    this.modo = 'maybeSingle';
    return this;
  }

  private linhas(): Linha[] {
    return (this.banco.tabelas[this.tabela] ??= []);
  }

  private executar(): Resultado {
    this.banco.antesDe?.(this.op, this.tabela);
    this.banco.log.push({ op: this.op, tabela: this.tabela });
    const agora = new Date().toISOString();
    let afetadas: Linha[];

    if (this.op === 'insert') {
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((l) => ({
        ...padroesDaTabela(this.tabela, agora),
        ...l,
      }));
      for (const nova of novas) {
        const erro = violacoes(this.banco, this.tabela, nova);
        if (erro) return { data: null, error: erro };
        this.linhas().push(nova);
      }
      afetadas = novas;
    } else if (this.op === 'update') {
      const alvo = this.linhas().filter((l) => this.filtros.every((f) => f(l)));
      for (const linha of alvo) {
        const erro = violacoes(this.banco, this.tabela, { ...linha, ...(this.payload as Linha) });
        if (erro) return { data: null, error: erro };
      }
      alvo.forEach((l) => Object.assign(l, this.payload));
      afetadas = alvo;
    } else if (this.op === 'delete') {
      afetadas = this.linhas().filter((l) => this.filtros.every((f) => f(l)));
      this.banco.tabelas[this.tabela] = this.linhas().filter((l) => !afetadas.includes(l));
    } else {
      afetadas = this.linhas().filter((l) => this.filtros.every((f) => f(l)));
      if (this.ordem) {
        const { coluna, asc } = this.ordem;
        afetadas = [...afetadas].sort((a, b) => String(a[coluna]).localeCompare(String(b[coluna])) * (asc ? 1 : -1));
      }
      if (this.limite !== null) afetadas = afetadas.slice(0, this.limite);
    }

    const copia = afetadas.map((l) => ({ ...l }));
    if (this.modo === 'lista') return { data: copia, error: null };
    if (copia.length > 1) return { data: null, error: { code: 'PGRST116', message: 'mais de uma linha' } };
    if (copia.length === 0 && this.modo === 'single') {
      return { data: null, error: { code: 'PGRST116', message: 'nenhuma linha' } };
    }
    return { data: copia[0] ?? null, error: null };
  }

  then<A = Resultado, B = never>(
    ok?: ((r: Resultado) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.executar())
      .then(ok, falha);
  }
}

export function criarSupabaseFake(banco: FakeBanco) {
  return { from: (tabela: string) => new Consulta(banco, tabela) };
}

/** Linha de `iss_solicitacoes` pronta para semear o banco. */
export function solicitacaoRow(over: Linha = {}): Linha {
  return {
    ...padroesDaTabela('iss_solicitacoes', '2026-09-28T10:00:00.000Z'),
    competencia: '2026-08',
    solicitado_por: '00000000-0000-4000-8000-0000000000aa',
    ...over,
  };
}
