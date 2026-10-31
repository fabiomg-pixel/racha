-- Racha — 0006: notificação push quando alguém lança uma despesa ou um acerto.
-- Rodar uma vez no SQL Editor. É seguro rodar de novo.
--
-- Desligar = cada pessoa remove a inscrição do aparelho (⚙ → Notificações). Sem inscrição, sem aviso.

create extension if not exists pg_net with schema extensions;

-- 1) um aparelho inscrito por linha (um usuário pode ter vários)
create table if not exists public.push_subs (
  endpoint    text primary key,
  user_id     uuid not null references auth.users on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs(user_id);
alter table public.push_subs enable row level security;
drop policy if exists push_subs_own on public.push_subs;
create policy push_subs_own on public.push_subs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) onde fica a Edge Function e o segredo do gatilho. Sem policy = só o servidor lê.
--    Preencha uma vez (troque REF e o segredo; é o NOTIFY_SECRET de supabase/SEGREDOS.local.txt):
--      insert into public.push_config(key, value) values
--        ('url',    'https://REF.supabase.co/functions/v1/notify'),
--        ('secret', 'COLE_O_NOTIFY_SECRET')
--      on conflict (key) do update set value = excluded.value;
create table if not exists public.push_config (key text primary key, value text not null);
alter table public.push_config enable row level security;

-- 3) gatilho: avisa a Edge Function. Nunca atrapalha o lançamento se algo falhar.
create or replace function public.notify_push() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare u text; s text;
begin
  -- despesa agendada pro futuro (parcelas, recorrentes) não avisa: só a que já vale hoje
  if tg_table_name = 'expenses' and new.spent_at > current_date then return new; end if;
  select value into u from public.push_config where key = 'url';
  select value into s from public.push_config where key = 'secret';
  if u is null or s is null then return new; end if;
  perform net.http_post(
    url := u,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', s),
    body := jsonb_build_object('kind', case tg_table_name when 'expenses' then 'expense' else 'settlement' end, 'id', new.id)
  );
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists expenses_push on public.expenses;
create trigger expenses_push after insert on public.expenses
  for each row execute function public.notify_push();
drop trigger if exists settlements_push on public.settlements;
create trigger settlements_push after insert on public.settlements
  for each row execute function public.notify_push();
