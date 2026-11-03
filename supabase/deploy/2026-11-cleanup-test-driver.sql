-- Limpeza do motorista de teste ANTES da atualização 0010–0014.
--
-- Escrito para o esquema ANTIGO (migrações 0001–0009: tabela global `periods`,
-- statements.period_id, adjustments.period_id). Rode UMA vez no SQL Editor do
-- Supabase, antes de `npx supabase db push`.
--
-- O que faz (tudo numa transação só; se algo falhar, nada é apagado):
--   apaga os gastos de corrida, corridas, abastecimentos, turnos, ajustes e extratos
--   desse motorista, solta o carro dele, apaga o perfil e a conta de login
--   (auth.identities + auth.users) e, por fim, as quinzenas globais (`periods`) que
--   ficaram sem extrato e sem ajuste.
--   As fotos já enviadas continuam guardadas no Storage (não atrapalham).
--
-- >>>>>>>>>> CONFIRA O CÓDIGO DE LOGIN ABAIXO ANTES DE RODAR <<<<<<<<<<
--   select login_code, name from profiles where role = 'driver';

begin;

set local session_replication_role = replica;

do $$
declare
  -- ======== CÓDIGO DE LOGIN DO MOTORISTA DE TESTE (confira!) ========
  v_login text := 'PASSOS01KAIQUE';
  -- ==================================================================
  v_id uuid;
  v_name text;
  n bigint;
begin
  select id, name into v_id, v_name from public.profiles
   where login_code = v_login and role = 'driver';
  if v_id is null then
    raise exception 'Motorista com código de login % não encontrado. Confira o código no topo do script.', v_login;
  end if;
  raise notice 'Apagando motorista % (%), id %', v_name, v_login, v_id;

  delete from public.ride_expenses
   where ride_id in (select id from public.rides where driver_id = v_id);
  get diagnostics n = row_count; raise notice 'ride_expenses apagados: %', n;

  delete from public.rides where driver_id = v_id;
  get diagnostics n = row_count; raise notice 'rides apagadas: %', n;

  delete from public.fuelings where driver_id = v_id;
  get diagnostics n = row_count; raise notice 'fuelings apagados: %', n;

  delete from public.shifts where driver_id = v_id;
  get diagnostics n = row_count; raise notice 'shifts apagados: %', n;

  delete from public.adjustments where driver_id = v_id;
  get diagnostics n = row_count; raise notice 'adjustments apagados: %', n;

  delete from public.statements where driver_id = v_id;
  get diagnostics n = row_count; raise notice 'statements apagados: %', n;

  update public.cars set current_driver_id = null where current_driver_id = v_id;
  get diagnostics n = row_count; raise notice 'carros liberados: %', n;

  delete from public.profiles where id = v_id;
  get diagnostics n = row_count; raise notice 'profiles apagados: %', n;

  delete from auth.identities where user_id = v_id;
  get diagnostics n = row_count; raise notice 'auth.identities apagadas: %', n;

  delete from auth.users where id = v_id;
  get diagnostics n = row_count; raise notice 'auth.users apagados: %', n;

  delete from public.periods p
   where not exists (select 1 from public.statements s where s.period_id = p.id)
     and not exists (select 1 from public.adjustments a where a.period_id = p.id);
  get diagnostics n = row_count; raise notice 'periods (quinzenas globais) vazias apagadas: %', n;

  select count(*) into n from public.profiles where role = 'driver';
  raise notice 'motoristas restantes: %', n;
  select count(*) into n from public.statements;
  raise notice 'extratos restantes: %', n;
  select count(*) into n from public.adjustments;
  raise notice 'ajustes restantes: %', n;
end $$;

commit;
