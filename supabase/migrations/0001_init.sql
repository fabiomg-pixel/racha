-- Racha Grupos — esquema do livro-razão (estilo Splitwise) + RLS + RPCs
-- Rodar uma vez no projeto Supabase: SQL Editor → cole tudo → Run.
-- (ou: supabase db push, com este arquivo em supabase/migrations/)

-- ───────────────────────────── tabelas ─────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text,
  pix_key     text,
  pix_name    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  currency    text not null default 'BRL',
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

-- membro do grupo. user_id null = "membro fantasma" (entrou no rolê mas não tem conta ainda).
create table if not exists public.group_members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups on delete cascade,
  user_id       uuid references auth.users on delete set null,
  display_name  text not null,
  role          text not null default 'member',
  created_at    timestamptz not null default now(),
  unique (group_id, user_id)
);
create index if not exists group_members_group_idx on public.group_members(group_id);
create index if not exists group_members_user_idx  on public.group_members(user_id);

create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups on delete cascade,
  description     text,
  place           text,
  spent_at        date not null default current_date,
  subtotal        numeric(12,2) not null default 0,
  service_rate    numeric(6,4)  not null default 0,   -- 0.10 = 10%
  service_amount  numeric(12,2) not null default 0,
  couvert         numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists expenses_group_idx on public.expenses(group_id);

create table if not exists public.expense_items (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses on delete cascade,
  name        text,
  qty         numeric(10,3) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  position    int not null default 0
);
create index if not exists expense_items_expense_idx on public.expense_items(expense_id);

-- quem consumiu cada item (peso permite dividir um item entre poucos com proporções)
create table if not exists public.item_shares (
  item_id    uuid not null references public.expense_items on delete cascade,
  member_id  uuid not null references public.group_members on delete cascade,
  weight     numeric(6,3) not null default 1,
  primary key (item_id, member_id)
);

-- quem pagou a conta (suporta vários pagadores / dois cartões)
create table if not exists public.expense_payers (
  expense_id  uuid not null references public.expenses on delete cascade,
  member_id   uuid not null references public.group_members on delete cascade,
  amount      numeric(12,2) not null,
  primary key (expense_id, member_id)
);

-- derivado e materializado: quanto cada um DEVE nesta despesa (calculado no cliente)
create table if not exists public.expense_shares (
  expense_id  uuid not null references public.expenses on delete cascade,
  member_id   uuid not null references public.group_members on delete cascade,
  amount      numeric(12,2) not null,
  primary key (expense_id, member_id)
);

-- acertos (pagamentos entre membros)
create table if not exists public.settlements (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups on delete cascade,
  from_member  uuid not null references public.group_members on delete cascade,
  to_member    uuid not null references public.group_members on delete cascade,
  amount       numeric(12,2) not null check (amount > 0),
  method       text not null default 'pix',
  note         text,
  settled_at   timestamptz not null default now(),
  created_by   uuid references auth.users on delete set null
);
create index if not exists settlements_group_idx on public.settlements(group_id);

-- ──────────────────── helpers (SECURITY DEFINER, sem recursão de RLS) ───────────────

-- é membro do grupo?  (definer = ignora RLS, evita recursão nas policies de group_members)
create or replace function public.is_member(g uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = auth.uid());
$$;

-- compartilho algum grupo com este usuário? (pra enxergar o perfil/pix dele)
create or replace function public.shares_group(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- posso ver/editar esta despesa? (sou membro do grupo dela)
create or replace function public.can_expense(e uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from expenses ex join group_members gm on gm.group_id = ex.group_id
    where ex.id = e and gm.user_id = auth.uid()
  );
$$;

-- posso ver/editar este item?
create or replace function public.can_item(i uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from expense_items it
      join expenses ex on ex.id = it.expense_id
      join group_members gm on gm.group_id = ex.group_id
    where it.id = i and gm.user_id = auth.uid()
  );
$$;

-- ───────────────────────────── RLS ─────────────────────────────

alter table public.profiles        enable row level security;
alter table public.groups          enable row level security;
alter table public.group_members   enable row level security;
alter table public.expenses        enable row level security;
alter table public.expense_items   enable row level security;
alter table public.item_shares     enable row level security;
alter table public.expense_payers  enable row level security;
alter table public.expense_shares  enable row level security;
alter table public.settlements     enable row level security;

-- profiles
drop policy if exists profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select
  using (id = auth.uid() or public.shares_group(id));
drop policy if exists profiles_upd on public.profiles;
create policy profiles_upd on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_ins on public.profiles;
create policy profiles_ins on public.profiles for insert
  with check (id = auth.uid());

-- groups
drop policy if exists groups_sel on public.groups;
create policy groups_sel on public.groups for select
  using (public.is_member(id) or created_by = auth.uid());
drop policy if exists groups_ins on public.groups;
create policy groups_ins on public.groups for insert
  with check (created_by = auth.uid());
drop policy if exists groups_upd on public.groups;
create policy groups_upd on public.groups for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists groups_del on public.groups;
create policy groups_del on public.groups for delete
  using (created_by = auth.uid());

-- group_members  (criador do grupo OU membro existente pode incluir gente)
drop policy if exists gm_sel on public.group_members;
create policy gm_sel on public.group_members for select
  using (public.is_member(group_id) or user_id = auth.uid());
drop policy if exists gm_ins on public.group_members;
create policy gm_ins on public.group_members for insert
  with check (public.is_member(group_id)
              or exists (select 1 from public.groups g where g.id = group_id and g.created_by = auth.uid()));
drop policy if exists gm_upd on public.group_members;
create policy gm_upd on public.group_members for update
  using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists gm_del on public.group_members;
create policy gm_del on public.group_members for delete
  using (public.is_member(group_id));

-- expenses
drop policy if exists exp_all on public.expenses;
create policy exp_all on public.expenses for all
  using (public.is_member(group_id)) with check (public.is_member(group_id));

-- expense_items
drop policy if exists items_all on public.expense_items;
create policy items_all on public.expense_items for all
  using (public.can_expense(expense_id)) with check (public.can_expense(expense_id));

-- item_shares
drop policy if exists ishares_all on public.item_shares;
create policy ishares_all on public.item_shares for all
  using (public.can_item(item_id)) with check (public.can_item(item_id));

-- expense_payers
drop policy if exists payers_all on public.expense_payers;
create policy payers_all on public.expense_payers for all
  using (public.can_expense(expense_id)) with check (public.can_expense(expense_id));

-- expense_shares
drop policy if exists eshares_all on public.expense_shares;
create policy eshares_all on public.expense_shares for all
  using (public.can_expense(expense_id)) with check (public.can_expense(expense_id));

-- settlements
drop policy if exists settle_all on public.settlements;
create policy settle_all on public.settlements for all
  using (public.is_member(group_id)) with check (public.is_member(group_id));

-- ───────────────── trigger: cria profile no signup ─────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────── RPC: cria a despesa inteira de forma atômica ─────────────────
-- O cálculo do rateio (expense_shares) é feito no cliente (split.js) e enviado pronto.
-- payload jsonb:
-- { group_id, description, place, spent_at, subtotal, service_rate, service_amount,
--   couvert, discount, total,
--   items:[{name, qty, unit_price, position, shares:[{member_id, weight}]}],
--   payers:[{member_id, amount}],
--   shares:[{member_id, amount}] }

create or replace function public.create_expense(payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g uuid := (payload->>'group_id')::uuid;
  eid uuid;
  it jsonb;
  iid uuid;
  sh jsonb;
  paid numeric;
  owed numeric;
  tot  numeric := coalesce((payload->>'total')::numeric, 0);
begin
  if not public.is_member(g) then
    raise exception 'forbidden: não é membro do grupo';
  end if;

  -- integridade: pagadores e rateio precisam bater com o total (tolerância 1 centavo)
  paid := coalesce((select sum((p->>'amount')::numeric) from jsonb_array_elements(payload->'payers') p), 0);
  owed := coalesce((select sum((s->>'amount')::numeric) from jsonb_array_elements(payload->'shares') s), 0);
  if abs(paid - tot) > 0.01 then raise exception 'pagadores (%) não somam o total (%)', paid, tot; end if;
  if abs(owed - tot) > 0.01 then raise exception 'rateio (%) não soma o total (%)', owed, tot; end if;

  insert into public.expenses
    (group_id, description, place, spent_at, subtotal, service_rate, service_amount, couvert, discount, total, created_by)
  values
    (g, payload->>'description', payload->>'place',
     coalesce((payload->>'spent_at')::date, current_date),
     coalesce((payload->>'subtotal')::numeric, 0),
     coalesce((payload->>'service_rate')::numeric, 0),
     coalesce((payload->>'service_amount')::numeric, 0),
     coalesce((payload->>'couvert')::numeric, 0),
     coalesce((payload->>'discount')::numeric, 0),
     tot, auth.uid())
  returning id into eid;

  for it in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
    insert into public.expense_items (expense_id, name, qty, unit_price, position)
    values (eid, it->>'name',
            coalesce((it->>'qty')::numeric, 1),
            coalesce((it->>'unit_price')::numeric, 0),
            coalesce((it->>'position')::int, 0))
    returning id into iid;
    for sh in select * from jsonb_array_elements(coalesce(it->'shares', '[]'::jsonb)) loop
      insert into public.item_shares (item_id, member_id, weight)
      values (iid, (sh->>'member_id')::uuid, coalesce((sh->>'weight')::numeric, 1));
    end loop;
  end loop;

  insert into public.expense_payers (expense_id, member_id, amount)
  select eid, (p->>'member_id')::uuid, (p->>'amount')::numeric
  from jsonb_array_elements(coalesce(payload->'payers', '[]'::jsonb)) p;

  insert into public.expense_shares (expense_id, member_id, amount)
  select eid, (s->>'member_id')::uuid, (s->>'amount')::numeric
  from jsonb_array_elements(coalesce(payload->'shares', '[]'::jsonb)) s;

  return eid;
end; $$;

-- ───────────────── RPC: saldo de cada membro no grupo ─────────────────
-- net > 0  => tem a receber.  net < 0 => deve.

create or replace function public.group_balances(g uuid)
returns table (
  member_id uuid, display_name text, user_id uuid,
  paid numeric, owed numeric, settled_out numeric, settled_in numeric, net numeric
)
language sql security definer stable set search_path = public as $$
  select gm.id, gm.display_name, gm.user_id,
         coalesce(p.paid,0), coalesce(s.owed,0), coalesce(so.amt,0), coalesce(si.amt,0),
         coalesce(p.paid,0) - coalesce(s.owed,0) + coalesce(si.amt,0) - coalesce(so.amt,0)
  from group_members gm
  left join (select member_id, sum(amount) paid from expense_payers ep
             join expenses e on e.id = ep.expense_id where e.group_id = g group by member_id) p on p.member_id = gm.id
  left join (select member_id, sum(amount) owed from expense_shares es
             join expenses e on e.id = es.expense_id where e.group_id = g group by member_id) s on s.member_id = gm.id
  left join (select from_member m, sum(amount) amt from settlements where group_id = g group by from_member) so on so.m = gm.id
  left join (select to_member m, sum(amount) amt from settlements where group_id = g group by to_member) si on si.m = gm.id
  where gm.group_id = g and public.is_member(g);
$$;

-- ───────────────── RPC: entrar num grupo por link de convite ─────────────────
-- Conhecer o group_id (uuid não-adivinhável) = autorização pra entrar (modelo do Splitwise).
-- claim opcional: id de um "membro fantasma" pra reivindicar ("esse sou eu").

-- lista os membros fantasma (sem conta) de um grupo — pra tela de convite oferecer "qual é você?"
create or replace function public.group_ghosts(g uuid)
returns table (id uuid, display_name text)
language sql security definer stable set search_path = public as $$
  select id, display_name from group_members where group_id = g and user_id is null order by display_name;
$$;

-- nome do grupo (pra prévia do convite, sem precisar ser membro ainda)
create or replace function public.group_name(g uuid)
returns text language sql security definer stable set search_path = public as $$
  select name from groups where id = g;
$$;

create or replace function public.join_group(g uuid, claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid; nm text;
begin
  if not exists (select 1 from groups where id = g) then
    raise exception 'grupo inexistente';
  end if;

  select id into mid from group_members where group_id = g and user_id = auth.uid();
  if mid is not null then return mid; end if;        -- já é membro

  if claim is not null then                          -- reivindicar um fantasma
    update group_members set user_id = auth.uid()
      where id = claim and group_id = g and user_id is null
      returning id into mid;
    if mid is not null then return mid; end if;
  end if;

  select name into nm from profiles where id = auth.uid();
  insert into group_members (group_id, user_id, display_name)
    values (g, auth.uid(), coalesce(nm, 'Convidado'))
    returning id into mid;
  return mid;
end; $$;

-- ───────────────── realtime (mesa ao vivo — fase 4) ─────────────────
do $$ begin
  alter publication supabase_realtime add table public.expenses;
  alter publication supabase_realtime add table public.expense_items;
  alter publication supabase_realtime add table public.item_shares;
  alter publication supabase_realtime add table public.expense_payers;
  alter publication supabase_realtime add table public.expense_shares;
  alter publication supabase_realtime add table public.settlements;
  alter publication supabase_realtime add table public.group_members;
exception when others then null; end $$;
