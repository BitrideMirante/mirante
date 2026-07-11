-- Rode este script no Supabase: Dashboard > SQL Editor > New query > colar > Run

create table if not exists app_data (
  id text primary key default 'singleton',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_data enable row level security;

-- Só usuários autenticados (logados) podem ler os dados do Mirante
create policy "Authenticated can read app_data"
on app_data for select
to authenticated
using (true);

-- Só usuários autenticados podem atualizar os dados
create policy "Authenticated can update app_data"
on app_data for update
to authenticated
using (true)
with check (true);

-- Só usuários autenticados podem inserir (necessário para a linha inicial, se ainda não existir)
create policy "Authenticated can insert app_data"
on app_data for insert
to authenticated
with check (true);

-- Cria a linha única onde tudo fica salvo (só roda se ainda não existir)
insert into app_data (id, payload)
values ('singleton', '{}'::jsonb)
on conflict (id) do nothing;
