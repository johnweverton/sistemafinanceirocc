// Forma compartilhada do resultado de importação em lote (médicos/empresas/clientes de
// contabilidade) — espelha `ResultadoImportacao`/`ErroLinha` de server/csv/planilha-import.ts.
export interface ImportarErro {
  linha: number;
  /** Identificador legível da linha (CPF, nome...) — o que faz sentido em cada domínio. */
  chave: string;
  erro: string;
}

export interface ImportarResultado {
  criados: number;
  erros: ImportarErro[];
}
