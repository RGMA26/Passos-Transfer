-- Quinzenas por motorista (ciclos de 15 dias a partir do cadastro), CPF, pausa (coluna)
-- e trava por quinzena do próprio motorista. Substitui a tabela global periods.
-- compute_statement / fuel_price_for / end_shift / admin_alerts ficam numa versão
-- provisória sobre driver_periods (Tasks 2–3 recriam); close_period é removido (Task 3).

-- ===== Trava de segurança da atualização =====
-- Antes desta migração não existe CPF: todo motorista cadastrado está sem CPF, e
-- extratos/ajustes antigos apontam para a tabela global periods (que some aqui).
do $$
declare
  n_drv int;
  n_st int;
  n_adj int;
  has_cpf boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'cpf')
    into has_cpf;
  if has_cpf then
    execute 'select count(*) from public.profiles where role = ''driver'' and cpf is null' into n_drv;
  else
    select count(*) into n_drv from public.profiles where role = 'driver';
  end if;
  select count(*) into n_st from public.statements;
  select count(*) into n_adj from public.adjustments;
  if n_drv > 0 then
    raise exception 'Atualização interrompida: há % motorista(s) sem CPF. Rode antes o script supabase/deploy/2026-11-cleanup-test-driver.sql (veja docs/DEPLOY.md, seção Atualização).', n_drv;
  end if;
  if n_st > 0 or n_adj > 0 then
    raise exception 'Atualização interrompida: há % extrato(s) e % ajuste(s) da versão antiga. Rode antes o script supabase/deploy/2026-11-cleanup-test-driver.sql (veja docs/DEPLOY.md, seção Atualização).', n_st, n_adj;
  end if;
end $$;

-- ===== Remove o modelo global =====
drop function if exists close_period(uuid, boolean);
drop function if exists close_period(uuid);
drop function if exists period_summary(uuid);
drop function if exists period_drivers(uuid);
drop function if exists period_movement_drivers(uuid);
drop function if exists compute_statement(uuid, uuid);
drop function if exists fuel_price_for(uuid, uuid);

alter table adjustments drop column period_id;
alter table statements drop column period_id;
drop table periods;
drop function if exists periods_freeze();
drop function if exists period_for_date(date);

-- ===== CPF =====
create function is_valid_cpf(p text) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
  s int;
  r int;
  i int;
begin
  if length(d) <> 11 or d ~ '^(.)\1{10}$' then
    return false;
  end if;
  -- só aceita dígitos e a máscara 000.000.000-00
  if p !~ '^[0-9]{11}$' and p !~ '^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$' then
    return false;
  end if;
  s := 0;
  for i in 1..9 loop
    s := s + substr(d, i, 1)::int * (11 - i);
  end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then
    return false;
  end if;
  s := 0;
  for i in 1..10 loop
    s := s + substr(d, i, 1)::int * (12 - i);
  end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

grant execute on function is_valid_cpf(text) to anon, authenticated, service_role;

-- ===== Colunas novas do perfil =====
alter table profiles
  add column cycle_start_date date,
  add column cpf text unique,
  add column paused boolean not null default false;

-- motoristas já existentes (não há em produção): ciclo a partir do cadastro
update profiles set cycle_start_date = (created_at at time zone 'America/Sao_Paulo')::date
 where role = 'driver';

alter table profiles
  add constraint profiles_cpf_valid check (cpf is null or (cpf ~ '^[0-9]{11}$' and is_valid_cpf(cpf))),
  add constraint profiles_driver_cpf check (role <> 'driver' or cpf is not null),
  add constraint profiles_driver_cycle check (role <> 'driver' or cycle_start_date is not null);

-- padrão: data de SP do created_at
create function profiles_default_cycle() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.role = 'driver' and new.cycle_start_date is null then
    new.cycle_start_date := (coalesce(new.created_at, now()) at time zone 'America/Sao_Paulo')::date;
  end if;
  return new;
end $$;

revoke execute on function profiles_default_cycle() from public, anon, authenticated;

create trigger profiles_default_cycle before insert on profiles
  for each row execute function profiles_default_cycle();

-- ===== Quinzenas do motorista =====
create table driver_periods (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  missing_fuel_price boolean not null default false,
  unique (driver_id, start_date),
  check (end_date >= start_date)
);

create index driver_periods_driver_dates_idx on driver_periods (driver_id, start_date, end_date);

alter table statements add column driver_period_id uuid not null unique references driver_periods(id);
alter table adjustments
  add column driver_period_id uuid not null references driver_periods(id),
  add column effective_date date not null default (now() at time zone 'America/Sao_Paulo')::date;
create index adjustments_driver_period_idx on adjustments (driver_period_id);

-- Quinzena fechada não muda mais (datas, status, marca)
create function driver_periods_freeze() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'closed' then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function driver_periods_freeze() from public, anon, authenticated;

create trigger driver_periods_freeze before update or delete on driver_periods
  for each row execute function driver_periods_freeze();

create trigger audit_driver_periods after insert or update or delete on driver_periods
  for each row execute function audit_row();

-- Resolve (e cria se preciso) a quinzena do motorista que contém a data. Interno: sem checagem
-- de quem chama (usado pelos gatilhos, antes do RLS decidir).
-- Regras: quinzena existente que contém a data → ela; data < cycle_start_date → BEFORE_CYCLE_START;
-- motorista pausado e data depois do fim da última quinzena → DRIVER_PAUSED (não cria quinzena
-- dentro da pausa, nem para o admin); senão cria [cycle + 15k, +14] (concorrência-segura).
create function resolve_driver_period(p_driver uuid, p_date date) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  drv profiles%rowtype;
  v_id uuid;
  v_start date;
  v_last date;
begin
  if p_date is null then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;

  select id into v_id from driver_periods
   where driver_id = p_driver and p_date between start_date and end_date;
  if found then
    return v_id;
  end if;

  select * into drv from profiles where id = p_driver;
  if not found or drv.role <> 'driver' or drv.cycle_start_date is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_date < drv.cycle_start_date then
    raise exception 'BEFORE_CYCLE_START' using errcode = 'P0001';
  end if;
  if drv.paused then
    select max(end_date) into v_last from driver_periods where driver_id = p_driver;
    if p_date > coalesce(v_last, drv.cycle_start_date - 1) then
      raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
    end if;
  end if;

  v_start := drv.cycle_start_date + ((p_date - drv.cycle_start_date) / 15) * 15;
  insert into driver_periods (driver_id, start_date, end_date)
    values (p_driver, v_start, v_start + 14)
    on conflict (driver_id, start_date) do nothing;
  select id into v_id from driver_periods
   where driver_id = p_driver and start_date = v_start and p_date between start_date and end_date;
  if v_id is null then
    -- a vaga do ciclo existe mas foi encurtada (pausa): a data não pertence a quinzena alguma
    raise exception 'NO_PERIOD' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

revoke execute on function resolve_driver_period(uuid, date) from public, anon, authenticated;

create function driver_period_for(p_driver uuid, p_date date) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from p_driver and not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return resolve_driver_period(p_driver, p_date);
end $$;

revoke execute on function driver_period_for(uuid, date) from public, anon;
grant execute on function driver_period_for(uuid, date) to authenticated, service_role;

-- ===== Ajustes: quinzena e effective_date =====
-- Sem driver_period_id: usa a quinzena da effective_date. Com driver_period_id: precisa ser do
-- motorista; effective_date fora dela → INVALID_EFFECTIVE_DATE, exceto o padrão (hoje) num
-- INSERT, que é trazido para dentro da quinzena escolhida.
-- Nome com "adjustments_a" para rodar antes de block_closed_period.
create function adjustments_a_period() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.effective_date is null then
    new.effective_date := v_today;
  end if;
  if new.driver_period_id is null then
    new.driver_period_id := resolve_driver_period(new.driver_id, new.effective_date);
  end if;
  select * into per from driver_periods where id = new.driver_period_id;
  if not found or per.driver_id <> new.driver_id then
    raise exception 'INVALID_PERIOD' using errcode = 'P0001';
  end if;
  if new.effective_date not between per.start_date and per.end_date then
    if tg_op = 'INSERT' and new.effective_date = v_today then
      new.effective_date := least(greatest(v_today, per.start_date), per.end_date);
    else
      raise exception 'INVALID_EFFECTIVE_DATE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

revoke execute on function adjustments_a_period() from public, anon, authenticated;

create trigger adjustments_a_period before insert or update on adjustments
  for each row execute function adjustments_a_period();

-- ===== Trava por quinzena do motorista =====
-- Motorista e data do registro (ajuste: a própria quinzena).
create function row_driver_date(p_table text, r jsonb, out driver uuid, out d date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  case p_table
    when 'rides' then driver := (r->>'driver_id')::uuid; d := (r->>'ride_date')::date;
    when 'fuelings' then driver := (r->>'driver_id')::uuid; d := (r->>'fueled_on')::date;
    when 'shifts' then driver := (r->>'driver_id')::uuid; d := (r->>'start_date')::date;
    when 'ride_expenses' then
      select x.driver_id, x.ride_date into driver, d from rides x where x.id = (r->>'ride_id')::uuid;
    else
      null;
  end case;
end $$;

revoke execute on function row_driver_date(text, jsonb) from public, anon, authenticated;

-- Lê a quinzena com FOR SHARE, SEM filtrar por status: espera o FOR UPDATE de um fechamento
-- concorrente e, ao liberar, reavalia a linha. Volatile (FOR SHARE é proibido em stable).
create or replace function row_in_closed_period(p_table text, r jsonb) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_driver uuid;
  d date;
  v_period uuid;
  v_status text;
begin
  if p_table = 'adjustments' then
    v_period := (r->>'driver_period_id')::uuid;
  else
    select x.driver, x.d into v_driver, d from row_driver_date(p_table, r) x;
    if v_driver is null or d is null then
      return false;
    end if;
    v_period := resolve_driver_period(v_driver, d);
  end if;
  if v_period is null then
    return false;
  end if;
  select status into v_status from driver_periods where id = v_period for share;
  return coalesce(v_status = 'closed', false);
end $$;

-- Pausa: o próprio motorista não lança depois do fim da última quinzena (DRIVER_PAUSED).
-- O admin não é barrado pela pausa dentro de quinzenas existentes; datas dentro da pausa não
-- têm quinzena e resolve_driver_period recusa para todos.
create or replace function block_closed_period() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_driver uuid;
  d date;
  v_last date;
begin
  if tg_op in ('INSERT', 'UPDATE') and tg_table_name <> 'adjustments' then
    select x.driver, x.d into v_driver, d from row_driver_date(tg_table_name, to_jsonb(new)) x;
    if v_driver is not null and v_driver = auth.uid()
       and exists (select 1 from profiles where id = v_driver and paused) then
      select max(end_date) into v_last from driver_periods where driver_id = v_driver;
      if v_last is null or d > v_last then
        raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and row_in_closed_period(tg_table_name, to_jsonb(old)) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and row_in_closed_period(tg_table_name, to_jsonb(new)) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function row_in_closed_period(text, jsonb) from public, anon, authenticated;
revoke execute on function block_closed_period() from public, anon, authenticated;

-- ===== RLS =====
alter table driver_periods enable row level security;
create policy admin_select on driver_periods for select to authenticated using (is_admin());
create policy driver_select_own on driver_periods for select to authenticated
  using (is_active_driver() and driver_id = auth.uid());
revoke insert, update, delete on driver_periods from anon, authenticated;

-- ===== Provisórias (Tasks 2–3 recriam) =====
-- Preço do litro: média dos abastecimentos aprovados do motorista na quinzena (sem referência).
create function fuel_price_for(p_driver uuid, p_period uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select sum(f.amount) / nullif(sum(f.liters), 0)
    from driver_periods p
    join fuelings f on f.driver_id = p_driver and f.review_status = 'approved'
                   and f.fueled_on between p.start_date and p.end_date
   where p.id = p_period
$$;

revoke execute on function fuel_price_for(uuid, uuid) from public, anon, authenticated;

create function compute_statement(p_driver uuid, p_period uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_price numeric;
  v_uber numeric;
  v_transfer numeric;
  v_fuel numeric;
  v_transfer_fuel numeric;
  v_own_km numeric;
  v_expense numeric;
  v_pending_exp numeric;
  v_pending_fuel numeric;
  v_km_total numeric;
  v_km_service numeric;
  v_km_off numeric;
  v_off_liters numeric;
  v_discount numeric;
  v_adjust numeric;
begin
  if not (is_admin() or (auth.uid() = p_driver and is_active_driver())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into per from driver_periods where id = p_period and driver_id = p_driver;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_price := fuel_price_for(p_driver, p_period);

  select round(coalesce(sum(amount * driver_pct / 100), 0), 2) into v_uber
    from rides
   where driver_id = p_driver and platform = 'uber'
     and ride_date between per.start_date and per.end_date;

  select round(coalesce(sum(amount * driver_pct / 100), 0), 2),
         coalesce(sum(km / consumption_km_l) filter (where consumption_km_l is not null), 0),
         coalesce(sum(km) filter (where consumption_km_l is not null), 0)
    into v_transfer, v_transfer_fuel, v_own_km
    from rides
   where driver_id = p_driver and platform = 'transfer'
     and transfer_status in ('completed', 'checked')
     and ride_date between per.start_date and per.end_date;
  v_transfer_fuel := round(v_transfer_fuel * coalesce(v_price, 0), 2);

  select coalesce(sum(amount) filter (where review_status = 'approved'), 0),
         coalesce(sum(amount) filter (where review_status = 'pending'), 0)
    into v_fuel, v_pending_fuel
    from fuelings
   where driver_id = p_driver
     and fueled_on between per.start_date and per.end_date;

  select coalesce(sum(e.amount) filter (where e.review_status = 'approved'), 0),
         coalesce(sum(e.amount) filter (where e.review_status = 'pending'), 0)
    into v_expense, v_pending_exp
    from ride_expenses e
    join rides r on r.id = e.ride_id
   where r.driver_id = p_driver and r.platform = 'transfer'
     and r.transfer_status in ('completed', 'checked')
     and r.ride_date between per.start_date and per.end_date;

  select coalesce(sum(t.km_total), 0),
         coalesce(sum(t.km_service), 0),
         coalesce(sum(t.km_off), 0),
         coalesce(sum(t.km_off / t.consumption_km_l), 0)
    into v_km_total, v_km_service, v_km_off, v_off_liters
    from (
      select s.consumption_km_l,
             s.odometer_end - s.odometer_start as km_total,
             coalesce(rs.km, 0) as km_service,
             greatest(0, s.odometer_end - s.odometer_start - coalesce(rs.km, 0)) as km_off
        from shifts s
        left join lateral (
          select sum(r.km) as km from rides r
           where r.shift_id = s.id and r.driver_id = s.driver_id
             and (r.platform <> 'transfer' or r.transfer_status in ('completed', 'checked'))
        ) rs on true
       where s.driver_id = p_driver
         and s.ended_at is not null
         and s.start_date between per.start_date and per.end_date
    ) t;
  v_discount := round(v_off_liters * coalesce(v_price, 0), 2);

  select coalesce(sum(amount), 0) into v_adjust
    from adjustments
   where driver_id = p_driver and driver_period_id = p_period;

  return jsonb_build_object(
    'uber_share', v_uber,
    'transfer_share', v_transfer,
    'fuel_reimbursement', v_fuel,
    'transfer_fuel_reimbursement', v_transfer_fuel,
    'expense_reimbursement', v_expense,
    'off_duty_fuel_discount', v_discount,
    'adjustments', v_adjust,
    'total', v_uber + v_transfer + v_fuel + v_transfer_fuel + v_expense - v_discount + v_adjust,
    'avg_fuel_price', round(coalesce(v_price, 0), 3),
    'missing_fuel_price', v_price is null and (v_own_km > 0 or v_km_off > 0),
    'km', jsonb_build_object('total', v_km_total, 'service', v_km_service, 'off', v_km_off),
    'pending', jsonb_build_object('fuelings', v_pending_fuel, 'expenses', v_pending_exp));
end $$;

revoke execute on function compute_statement(uuid, uuid) from public, anon;
grant execute on function compute_statement(uuid, uuid) to authenticated;

create or replace function end_shift(p_shift_id uuid, p_odometer int, p_photo text, p_uber_photo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s shifts%rowtype;
  v_total int;
  v_service numeric;
  v_off numeric;
  v_price numeric;
  v_period uuid;
begin
  if not is_active_driver() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into s from shifts where id = p_shift_id and driver_id = auth.uid() for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if s.ended_at is null then
    if p_odometer is null or p_odometer < s.odometer_start then
      raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
    end if;
    if p_photo is null or btrim(p_photo) = '' then
      raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
    end if;
    if (p_uber_photo is null or btrim(p_uber_photo) = '')
       and exists (select 1 from rides where shift_id = s.id and platform = 'uber') then
      raise exception 'UBER_PHOTO_REQUIRED' using errcode = 'P0001';
    end if;
    update shifts
      set ended_at = now(), odometer_end = p_odometer, odometer_end_photo = p_photo,
          uber_earnings_photo = nullif(btrim(p_uber_photo), '')
      where id = s.id
      returning * into s;
  end if;

  v_total := s.odometer_end - s.odometer_start;
  select coalesce(sum(km), 0) into v_service from rides
   where shift_id = s.id and driver_id = s.driver_id
     and (platform <> 'transfer' or transfer_status in ('completed', 'checked'));
  v_off := greatest(v_total - v_service, 0);
  -- statement separado: a quinzena pode ser criada aqui e fuel_price_for (stable)
  -- só a enxerga num snapshot posterior
  v_period := driver_period_for(s.driver_id, s.start_date);
  v_price := fuel_price_for(s.driver_id, v_period);
  return jsonb_build_object(
    'km_total', v_total,
    'km_service', v_service,
    'km_off', v_off,
    'off_discount_estimate', round(v_off / s.consumption_km_l * v_price, 2));
end $$;

-- admin_alerts: só turnos de quinzenas (do motorista) não fechadas
create or replace function admin_alerts()
returns table(kind text, driver_id uuid, shift_id uuid, detail jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
  with t as (
    select s.id, s.driver_id as drv, s.started_at, s.ended_at,
           s.odometer_end - s.odometer_start as km_total,
           coalesce((select sum(r.km) from rides r
                      where r.shift_id = s.id and r.driver_id = s.driver_id
                        and (r.platform <> 'transfer'
                             or r.transfer_status in ('completed', 'checked'))), 0) as km_service
      from shifts s
     where not exists (select 1 from driver_periods p
                        where p.driver_id = s.driver_id and p.status = 'closed'
                          and s.start_date between p.start_date and p.end_date)
  ), a as (
    select 'HIGH_OFF_KM'::text as k, t.drv, t.id, t.started_at,
           jsonb_build_object('km_total', t.km_total, 'km_service', t.km_service,
                              'km_off', t.km_total - t.km_service) as det
      from t
     where t.ended_at is not null and t.km_total > 0
       and (t.km_total - t.km_service)::numeric / t.km_total > 0.20
    union all
    select 'NEGATIVE_OFF_KM', t.drv, t.id, t.started_at,
           jsonb_build_object('km_total', t.km_total, 'km_service', t.km_service,
                              'km_off', t.km_total - t.km_service)
      from t
     where t.ended_at is not null and t.km_service > t.km_total
    union all
    select 'SHIFT_OPEN_24H', t.drv, t.id, t.started_at,
           jsonb_build_object('started_at', t.started_at)
      from t
     where t.ended_at is null and t.started_at < now() - interval '24 hours'
  )
  select a.k, a.drv, a.id, a.det from a order by a.drv, a.started_at;
end $$;
