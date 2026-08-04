-- Migration 0040 — amplia conta_emissora de 2 para 4 contas (2026-08-03).
-- Contexto: além de MC e Cavalcante Viana (médicos/empresas, Épico 7), o serviço de
-- contabilidade passa a emitir por DUAS contas próprias: Carmem Cavalcante e CC Soluções.
-- Decisão do dono: as 4 contas ficam disponíveis para QUALQUER boleto do sistema (médicos,
-- empresas e clientes de contabilidade) — não é um domínio isolado, é o mesmo CHECK
-- (mc, cavalcante_viana, carmem_cavalcante, cc_solucoes) em todas as tabelas que já tinham
-- conta_emissora. Nada muda para quem já usa mc/cavalcante_viana — é aditivo.
-- Idempotente: drop constraint if exists (nomeada) + add constraint, mesmo padrão da 0021/0028/0030.

alter table medicos drop constraint if exists chk_medicos_conta_emissora;
alter table medicos add constraint chk_medicos_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

alter table boletos drop constraint if exists chk_boletos_conta_emissora;
alter table boletos add constraint chk_boletos_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

alter table extrato_transacoes drop constraint if exists chk_extrato_conta_emissora;
alter table extrato_transacoes add constraint chk_extrato_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

alter table extrato_syncs drop constraint if exists chk_extrato_syncs_conta_emissora;
alter table extrato_syncs add constraint chk_extrato_syncs_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

alter table dre_lancamentos_manuais drop constraint if exists chk_dre_lanc_conta_emissora;
alter table dre_lancamentos_manuais add constraint chk_dre_lanc_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

alter table empresas drop constraint if exists chk_empresas_conta_emissora;
alter table empresas add constraint chk_empresas_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_conta_emissora;
alter table clientes_contabilidade add constraint chk_clientes_contabilidade_conta_emissora
  check (conta_emissora in ('mc', 'cavalcante_viana', 'carmem_cavalcante', 'cc_solucoes'));

-- lote_emissao_itens.conta_emissora (migration 0038) foi criada com CHECK inline, sem nome —
-- o Postgres autogera o nome (padrão <tabela>_<coluna>_check). Descoberta dinâmica em vez de
-- assumir o nome, para não falhar caso o autogerado seja diferente do esperado. A tabela é
-- OPCIONAL nesta migration: se 0038 ainda não rodou neste banco, este bloco só é ignorado —
-- quando 0038 rodar depois, já cria o CHECK com as 4 contas (ver header da 0038 atualizado).
do $$
declare
  r record;
begin
  if to_regclass('public.lote_emissao_itens') is null then
    return;
  end if;

  for r in
    select conname
    from pg_constraint
    where conrelid = 'lote_emissao_itens'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%conta_emissora%'
  loop
    execute format('alter table lote_emissao_itens drop constraint %I', r.conname);
  end loop;

  execute
    'alter table lote_emissao_itens add constraint chk_lote_emissao_itens_conta_emissora '
    || 'check (conta_emissora in (''mc'', ''cavalcante_viana'', ''carmem_cavalcante'', ''cc_solucoes''))';
end $$;

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário — reverte para só mc/cavalcante_viana;
-- só é seguro se nenhuma linha já usar carmem_cavalcante/cc_solucoes).
-- ============================================================================
-- alter table medicos drop constraint if exists chk_medicos_conta_emissora;
-- alter table medicos add constraint chk_medicos_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table boletos drop constraint if exists chk_boletos_conta_emissora;
-- alter table boletos add constraint chk_boletos_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table extrato_transacoes drop constraint if exists chk_extrato_conta_emissora;
-- alter table extrato_transacoes add constraint chk_extrato_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table extrato_syncs drop constraint if exists chk_extrato_syncs_conta_emissora;
-- alter table extrato_syncs add constraint chk_extrato_syncs_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table dre_lancamentos_manuais drop constraint if exists chk_dre_lanc_conta_emissora;
-- alter table dre_lancamentos_manuais add constraint chk_dre_lanc_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table empresas drop constraint if exists chk_empresas_conta_emissora;
-- alter table empresas add constraint chk_empresas_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table clientes_contabilidade drop constraint if exists chk_clientes_contabilidade_conta_emissora;
-- alter table clientes_contabilidade add constraint chk_clientes_contabilidade_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
-- alter table lote_emissao_itens drop constraint if exists chk_lote_emissao_itens_conta_emissora;
-- alter table lote_emissao_itens add constraint chk_lote_emissao_itens_conta_emissora check (conta_emissora in ('mc', 'cavalcante_viana'));
