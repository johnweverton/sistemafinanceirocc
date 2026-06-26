-- Migration 0005 — campo necessita_configuracao em medicos.
-- Marca médicos auto-descobertos via API da Carmem que ainda não têm os parâmetros
-- de faturamento configurados. Esses registros são excluídos das execuções até que
-- um operador preencha statusHapvida, fazOutrosHospitais etc. (auto-descoberta PRD §6.4).

alter table medicos
  add column necessita_configuracao boolean not null default false;

-- Índice para filtrar rapidamente os ativos configurados (hot path do orquestrador).
create index idx_medicos_configurados
  on medicos (ativo, necessita_configuracao)
  where ativo = true and necessita_configuracao = false;
