create type public.disparo_canal as enum ('whatsapp', 'email');
create type public.disparo_status as enum ('sucesso', 'falha');

create table public.boletos_disparos (
  id uuid primary key default gen_random_uuid(),
  boleto_id uuid not null references public.boletos(id) on delete cascade,
  canal public.disparo_canal not null,
  status public.disparo_status not null,
  mensagem_erro text,
  enviado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS
alter table public.boletos_disparos enable row level security;

-- Policies
create policy "Usuários podem ver disparos dos seus boletos" on public.boletos_disparos
  for select using (
    exists (
      select 1 from public.boletos b
      where b.id = boletos_disparos.boleto_id
    )
  );

-- O servidor insere (via service_role), então insert via api public não precisa.

-- Índices para performance
create index idx_boletos_disparos_boleto_id on public.boletos_disparos(boleto_id);
