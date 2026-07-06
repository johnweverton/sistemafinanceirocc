-- 0012: IDs da origem passam de uuid para text.
--
-- Motivo: a API real da Carmem devolve IDs numéricos (ex.: 313), não UUIDs —
-- o contrato presumido em docs/integracao/api-financeiro-sistema-web.md usava
-- UUIDs de exemplo (Épico 5: contrato real ≠ presumido). Com as colunas em
-- uuid, todo INSERT de vínculo/criação falhava.
--
-- Mudança relaxante e sem perda: uuid::text preserva os valores existentes e
-- o índice único parcial (uq_medicos_external_id) é reconstruído no ALTER.

alter table medicos
  alter column external_id type text using external_id::text;

comment on column medicos.external_id is
  'ID do médico na origem (fin-clientes.id da API do sistema web — numérico serializado como texto). Vínculo permanente — nunca reatribuir (Épico 5, decisão 4).';

alter table execucao_selecoes
  alter column producao_externa_id type text using producao_externa_id::text;

comment on column execucao_selecoes.producao_externa_id is
  'ID da produção na origem (fin-producoes.id — numérico serializado como texto).';

-- Rollback (só é seguro se todos os valores forem UUIDs válidos):
-- alter table medicos alter column external_id type uuid using external_id::uuid;
-- alter table execucao_selecoes alter column producao_externa_id type uuid using producao_externa_id::uuid;
