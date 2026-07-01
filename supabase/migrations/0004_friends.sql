-- Racha Grupos — 0004: "amigos" (despesa 1-a-1 sem grupo). Fase 4.
-- Rodar UMA vez no SQL Editor (depois do 0001..0003). É seguro rodar de novo.
--
-- Um "amigo" é só um grupo de 2 pessoas com kind='friend' — reusa toda a máquina
-- (despesas, divisão, saldo, acerto por Pix, atividade, comentários). A home separa
-- 'friend' (Amigos) de 'group' (Grupos).

alter table public.groups add column if not exists kind text not null default 'group';
