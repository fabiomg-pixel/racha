-- Racha Grupos — 0002: categoria + nota na despesa, e edição de despesa.
-- Rodar UMA vez no SQL Editor do Supabase (depois do 0001). É seguro rodar de novo.

-- 1) novas colunas
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists note     text;

-- 2) helper: (re)insere itens/pagadores/rateio de uma despesa a partir do payload jsonb
create or replace function public._fill_expense_children(eid uuid, payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb; iid uuid; sh jsonb;
begin
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
end; $$;

-- 3) create_expense: agora também guarda category e note (resto igual ao 0001)
create or replace function public.create_expense(payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g uuid := (payload->>'group_id')::uuid;
  eid uuid;
  paid numeric; owed numeric;
  tot  numeric := coalesce((payload->>'total')::numeric, 0);
begin
  if not public.is_member(g) then raise exception 'forbidden: não é membro do grupo'; end if;
  paid := coalesce((select sum((p->>'amount')::numeric) from jsonb_array_elements(payload->'payers') p), 0);
  owed := coalesce((select sum((s->>'amount')::numeric) from jsonb_array_elements(payload->'shares') s), 0);
  if abs(paid - tot) > 0.01 then raise exception 'pagadores (%) não somam o total (%)', paid, tot; end if;
  if abs(owed - tot) > 0.01 then raise exception 'rateio (%) não soma o total (%)', owed, tot; end if;

  insert into public.expenses
    (group_id, description, place, spent_at, subtotal, service_rate, service_amount,
     couvert, discount, total, category, note, created_by)
  values
    (g, payload->>'description', payload->>'place',
     coalesce((payload->>'spent_at')::date, current_date),
     coalesce((payload->>'subtotal')::numeric, 0),
     coalesce((payload->>'service_rate')::numeric, 0),
     coalesce((payload->>'service_amount')::numeric, 0),
     coalesce((payload->>'couvert')::numeric, 0),
     coalesce((payload->>'discount')::numeric, 0),
     tot, payload->>'category', payload->>'note', auth.uid())
  returning id into eid;

  perform public._fill_expense_children(eid, payload);
  return eid;
end; $$;

-- 4) update_expense: edita uma despesa existente (mesma checagem de integridade)
create or replace function public.update_expense(payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  eid  uuid := (payload->>'id')::uuid;
  paid numeric; owed numeric;
  tot  numeric := coalesce((payload->>'total')::numeric, 0);
begin
  if not public.can_expense(eid) then raise exception 'forbidden: não pode editar esta despesa'; end if;
  paid := coalesce((select sum((p->>'amount')::numeric) from jsonb_array_elements(payload->'payers') p), 0);
  owed := coalesce((select sum((s->>'amount')::numeric) from jsonb_array_elements(payload->'shares') s), 0);
  if abs(paid - tot) > 0.01 then raise exception 'pagadores (%) não somam o total (%)', paid, tot; end if;
  if abs(owed - tot) > 0.01 then raise exception 'rateio (%) não soma o total (%)', owed, tot; end if;

  update public.expenses set
    description    = payload->>'description',
    place          = payload->>'place',
    spent_at       = coalesce((payload->>'spent_at')::date, spent_at),
    subtotal       = coalesce((payload->>'subtotal')::numeric, 0),
    service_rate   = coalesce((payload->>'service_rate')::numeric, 0),
    service_amount = coalesce((payload->>'service_amount')::numeric, 0),
    couvert        = coalesce((payload->>'couvert')::numeric, 0),
    discount       = coalesce((payload->>'discount')::numeric, 0),
    total          = tot,
    category       = payload->>'category',
    note           = payload->>'note'
  where id = eid;

  delete from public.expense_items  where expense_id = eid;   -- cascade limpa item_shares
  delete from public.expense_payers where expense_id = eid;
  delete from public.expense_shares where expense_id = eid;
  perform public._fill_expense_children(eid, payload);
  return eid;
end; $$;
