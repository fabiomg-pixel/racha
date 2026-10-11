-- Racha — 0005: tempo real mais confiável (OPCIONAL; o app já se atualiza sozinho sem isto).
-- Rodar uma vez no SQL Editor. É seguro rodar de novo.
--
-- 1) O 0001 adicionava as tabelas à publicação num bloco só: se UMA falhasse, as seguintes ficavam de fora.
--    Aqui cada tabela é adicionada separadamente.
do $$
declare t text;
begin
  foreach t in array array['expenses','expense_items','item_shares','expense_payers','expense_shares','settlements','group_members','expense_comments'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;   -- já estava na publicação (ou a tabela não existe): segue
    end;
  end loop;
end $$;

-- 2) Sem isto, o aviso de EXCLUSÃO não traz o group_id, e o filtro por grupo do app descarta o evento.
alter table public.expenses      replica identity full;
alter table public.settlements   replica identity full;
alter table public.group_members replica identity full;
