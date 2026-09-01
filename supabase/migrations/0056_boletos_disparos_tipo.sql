-- Migration 0056 — coluna `tipo` em boletos_disparos: discrimina disparo de EMISSÃO do novo
-- lembrete de vencimento (D-1, Épico 13 Fase 1). Sem isso, um lembrete gravado na mesma tabela
-- ficaria indistinguível visualmente do disparo de emissão original em DisparoBadges.tsx (o
-- componente mostra sempre o disparo mais recente por canal — um lembrete sobrescreveria a
-- badge de emissão).
--
-- Enum como TEXT + CHECK (mesmo padrão de boletos.status e clientes_contabilidade.modo_vencimento,
-- 0055): acrescentar um valor novo no futuro é só `drop constraint` + `add constraint` numa
-- migration nova, sem `alter type ... add value`. 'cobranca_vencido' já entra reservado no CHECK
-- (Fase 2 — reforço pós-vencimento, não implementada ainda) para essa extensão futura não exigir
-- outra migration só para liberar o valor do enum.
--
-- Idempotente: seguro para rodar mais de uma vez (if not exists / drop+add de constraint/índice).

alter table boletos_disparos add column if not exists tipo text not null default 'emissao';
-- Retroatividade: o DEFAULT no ADD COLUMN já preenche as linhas existentes (todo disparo
-- histórico é de emissão — não havia outro tipo até aqui). Não precisa de UPDATE explícito.

alter table boletos_disparos drop constraint if exists chk_boletos_disparos_tipo;
alter table boletos_disparos add constraint chk_boletos_disparos_tipo
  check (tipo in ('emissao', 'lembrete_vencimento', 'cobranca_vencido'));

comment on column boletos_disparos.tipo is
  'Tipo do disparo: emissao (envio do boleto ao emitir), lembrete_vencimento (D-1, Épico 13 '
  'Fase 1), cobranca_vencido (reforço pós-vencimento, Fase 2 — reservado, ainda não emitido).';

-- Índice para a checagem de idempotência do cron de lembrete ("já existe disparo tipo=X para
-- este boleto_id?"), rodada 1x por boleto por dia — evita full scan conforme a tabela cresce.
create index if not exists idx_boletos_disparos_boleto_tipo on boletos_disparos (boleto_id, tipo);

-- Índice único parcial: fecha a corrida de duplicidade de vez (a checagem lógica de idempotência
-- na rota é leitura-antes-de-escrever, não uma trava real — duas execuções do cron em paralelo,
-- ex. deploy duplo + schedule real no mesmo minuto, poderiam mandar o lembrete duas vezes sem
-- isso). A rota trata o erro 23505 deste índice como "já foi enviado, tudo certo" — mesmo
-- espírito do uq_boletos_resultado_ativo usado na emissão (migration 0037).
create unique index if not exists uq_boletos_disparos_lembrete_sucesso
  on boletos_disparos (boleto_id)
  where tipo = 'lembrete_vencimento' and status = 'sucesso';

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário)
-- ============================================================================
-- drop index if exists uq_boletos_disparos_lembrete_sucesso;
-- drop index if exists idx_boletos_disparos_boleto_tipo;
-- alter table boletos_disparos drop constraint if exists chk_boletos_disparos_tipo;
-- alter table boletos_disparos drop column if exists tipo;
