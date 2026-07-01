-- Racha Grupos — 0003: comentários na despesa (Fase 3).
-- Rodar UMA vez no SQL Editor (depois do 0001 e 0002). É seguro rodar de novo.

create table if not exists public.expense_comments (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses on delete cascade,
  user_id     uuid references auth.users on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists expense_comments_expense_idx on public.expense_comments(expense_id);

alter table public.expense_comments enable row level security;

-- quem é membro do grupo da despesa vê os comentários; escreve com o próprio user_id; apaga o seu
drop policy if exists ecomments_sel on public.expense_comments;
create policy ecomments_sel on public.expense_comments for select
  using (public.can_expense(expense_id));
drop policy if exists ecomments_ins on public.expense_comments;
create policy ecomments_ins on public.expense_comments for insert
  with check (public.can_expense(expense_id) and user_id = auth.uid());
drop policy if exists ecomments_del on public.expense_comments;
create policy ecomments_del on public.expense_comments for delete
  using (user_id = auth.uid());

-- realtime pros comentários (opcional; ignora se já estiver na publicação)
do $$ begin
  alter publication supabase_realtime add table public.expense_comments;
exception when others then null; end $$;
