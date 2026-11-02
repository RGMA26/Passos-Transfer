-- Fechamento individual da quinzena, sinais de prazo, pausa/retomada do motorista (spec §2.2–2.4,
-- §3.2, §9.1). Também: quinzenas do mesmo motorista não se sobrepõem (exclusion) e
-- cycle_start_date só muda pela retomada (CYCLE_START_LOCKED).

create extension if not exists btree_gist;

-- ===== Quinzenas do motorista não se sobrepõem =====
alter table driver_periods add constraint driver_periods_no_overlap
  exclude using gist (driver_id with =, daterange(start_date, end_date, '[]') with &&);

-- Igual à 0010, mas ON CONFLICT sem alvo: a exclusion também é árbitro (concorrência e vaga
-- sobreposta caem em NO_PERIOD em vez de erro 23P01).
create or replace function resolve_driver_period(p_driver uuid, p_date date) returns uuid
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
    on conflict do nothing;
  select id into v_id from driver_periods
   where driver_id = p_driver and start_date = v_start and p_date between start_date and end_date;
  if v_id is null then
    -- a vaga do ciclo existe mas foi encurtada (pausa): a data não pertence a quinzena alguma
    raise exception 'NO_PERIOD' using errcode = 'P0001';
  end if;
  return v_id;
end $$;

-- ===== cycle_start_date: só muda pela retomada =====
-- resume_driver liga a flag de sessão passos.resume_driver (local à transação) e, no mesmo
-- UPDATE, tira o perfil da pausa; a flag sozinha não basta (exige paused true → false).
create function profiles_cycle_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.cycle_start_date is distinct from old.cycle_start_date
     and not (coalesce(current_setting('passos.resume_driver', true), '') = 'on'
              and old.paused and not new.paused) then
    raise exception 'CYCLE_START_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function profiles_cycle_lock() from public, anon, authenticated;

create trigger profiles_cycle_lock before update on profiles
  for each row execute function profiles_cycle_lock();

-- ===== Histórico de pausas =====
create table driver_pauses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  driver_id uuid not null references profiles(id),
  paused_on date not null,
  resumed_on date,
  reason text,
  check (resumed_on is null or resumed_on > paused_on)
);

create index driver_pauses_driver_idx on driver_pauses (driver_id, paused_on);
-- no máximo uma pausa em aberto por motorista
create unique index driver_pauses_open_idx on driver_pauses (driver_id) where resumed_on is null;

alter table driver_pauses enable row level security;
create policy admin_select on driver_pauses for select to authenticated using (is_admin());
revoke insert, update, delete on driver_pauses from anon, authenticated;

create trigger audit_driver_pauses after insert or update or delete on driver_pauses
  for each row execute function audit_row();

-- ===== Fechamento individual =====
drop function if exists close_period(uuid, boolean);
drop function if exists close_period(uuid);

create function close_driver_period(p_period uuid, p_force boolean default false,
                                    p_allow_missing_fuel_price boolean default false)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_lines jsonb;
  v_missing boolean;
  v_id uuid;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- FOR UPDATE: escritas concorrentes (row_in_closed_period, FOR SHARE) esperam o fechamento
  select * into per from driver_periods where id = p_period for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if per.status = 'closed' then
    raise exception 'ALREADY_CLOSED' using errcode = 'P0001';
  end if;
  if exists (select 1 from driver_periods
              where driver_id = per.driver_id and status = 'open' and start_date < per.start_date) then
    raise exception 'PREVIOUS_OPEN' using errcode = 'P0001';
  end if;
  if (now() at time zone 'America/Sao_Paulo')::date <= per.end_date and not coalesce(p_force, false) then
    raise exception 'PERIOD_NOT_ENDED' using errcode = 'P0001';
  end if;

  if exists (select 1 from shifts
              where driver_id = per.driver_id and ended_at is null
                and start_date between per.start_date and per.end_date) then
    raise exception 'OPEN_SHIFTS' using errcode = 'P0001';
  end if;

  if exists (select 1 from rides
              where driver_id = per.driver_id and platform = 'transfer'
                and transfer_status in ('assigned', 'in_progress')
                and ride_date between per.start_date and per.end_date) then
    raise exception 'ASSIGNED_TRANSFERS' using errcode = 'P0001';
  end if;

  if exists (select 1 from fuelings
              where driver_id = per.driver_id and review_status = 'pending'
                and fueled_on between per.start_date and per.end_date)
     or exists (select 1 from ride_expenses e join rides r on r.id = e.ride_id
                 where r.driver_id = per.driver_id and e.review_status = 'pending'
                   and r.ride_date between per.start_date and per.end_date)
     or exists (select 1 from shifts
                 where driver_id = per.driver_id and review_status = 'pending'
                   and start_date between per.start_date and per.end_date)
     or exists (select 1 from rides
                 where driver_id = per.driver_id and platform = 'transfer'
                   and transfer_status = 'completed'
                   and ride_date between per.start_date and per.end_date) then
    raise exception 'PENDING_REVIEW' using errcode = 'P0001';
  end if;

  if exists (select 1 from shifts
              where driver_id = per.driver_id and ended_at is not null
                and review_status <> 'approved'
                and start_date between per.start_date and per.end_date) then
    raise exception 'SHIFTS_NOT_APPROVED' using errcode = 'P0001';
  end if;

  v_lines := compute_statement(per.driver_id, per.id);
  v_missing := coalesce((v_lines->>'missing_fuel_price')::boolean, false)
            or coalesce((v_lines->>'missing_consumption')::boolean, false);
  if v_missing and not coalesce(p_allow_missing_fuel_price, false) then
    raise exception 'MISSING_FUEL_PRICE' using errcode = 'P0001';
  end if;

  insert into statements (driver_id, driver_period_id, lines, total)
    values (per.driver_id, per.id, v_lines, (v_lines->>'total')::numeric)
    returning id into v_id;

  update driver_periods
     set status = 'closed', closed_at = now(), missing_fuel_price = v_missing
   where id = per.id;
  return v_id;
end $$;

-- mark_statement_paid: igual à 0006 (o extrato agora aponta para driver_period_id; nada muda aqui)
create or replace function mark_statement_paid(p_statement uuid, p_paid_at date, p_method text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_paid_at is null or p_method is null or btrim(p_method) = '' then
    raise exception 'PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;
  update statements set paid_at = p_paid_at, payment_method = btrim(p_method)
    where id = p_statement;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

-- ===== Sinais de prazo =====
-- Motoristas ativos. Não pausado: a quinzena de hoje é resolvida (criada se preciso);
-- 🔴 se há quinzena aberta com end_date < hoje; senão 🟡 se end_date − hoje ≤ 5.
-- Pausado: quinzena de hoje só se existir; apenas 🔴.
create function driver_period_signals()
returns table(driver_id uuid, name text, paused boolean, current_period_id uuid,
              start_date date, end_date date, days_left int, signal text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  drv record;
  v_pid uuid;
  per driver_periods%rowtype;
  v_red boolean;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  for drv in
    select p.id, p.name, p.paused, p.cycle_start_date from profiles p
     where p.role = 'driver' and p.active
     order by p.name, p.id
  loop
    v_pid := null;
    if not drv.paused and drv.cycle_start_date is not null and v_today >= drv.cycle_start_date then
      v_pid := resolve_driver_period(drv.id, v_today);
    else
      select dp.id into v_pid from driver_periods dp
       where dp.driver_id = drv.id and v_today between dp.start_date and dp.end_date;
    end if;
    per := null;
    if v_pid is not null then
      select * into per from driver_periods dp where dp.id = v_pid;
    end if;
    v_red := exists (select 1 from driver_periods dp
                      where dp.driver_id = drv.id and dp.status = 'open' and dp.end_date < v_today);

    driver_id := drv.id;
    name := drv.name;
    paused := drv.paused;
    current_period_id := v_pid;
    start_date := per.start_date;
    end_date := per.end_date;
    days_left := per.end_date - v_today;
    signal := case
      when v_red then 'red'
      when not drv.paused and per.status = 'open' and per.end_date - v_today <= 5 then 'yellow'
    end;
    return next;
  end loop;
end $$;

-- ===== Pausa e retomada =====
create function pause_driver(p_driver uuid, p_paused_on date, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  drv profiles%rowtype;
  v_period uuid;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- serializa com start_shift (mesmo lock) e com start/complete_transfer (FOR SHARE)
  select * into drv from profiles where id = p_driver and role = 'driver' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if drv.paused then
    raise exception 'ALREADY_PAUSED' using errcode = 'P0001';
  end if;
  if exists (select 1 from shifts where driver_id = p_driver and ended_at is null) then
    raise exception 'OPEN_SHIFTS' using errcode = 'P0001';
  end if;
  if p_paused_on is null then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;

  -- garante a quinzena que contém a data da pausa (BEFORE_CYCLE_START se antes do ciclo)
  v_period := driver_period_for(p_driver, p_paused_on);

  -- nada pode ficar com data depois da pausa (ficaria fora de qualquer quinzena)
  if exists (select 1 from rides where driver_id = p_driver and ride_date > p_paused_on)
     or exists (select 1 from fuelings where driver_id = p_driver and fueled_on > p_paused_on)
     or exists (select 1 from shifts where driver_id = p_driver and start_date > p_paused_on)
     or exists (select 1 from adjustments where driver_id = p_driver and effective_date > p_paused_on) then
    raise exception 'ENTRIES_AFTER_PAUSE' using errcode = 'P0001';
  end if;

  -- quinzenas futuras (vazias) somem; a que contém a pausa termina nela
  delete from driver_periods where driver_id = p_driver and start_date > p_paused_on;
  update driver_periods set end_date = p_paused_on
   where id = v_period and end_date <> p_paused_on;

  update profiles set paused = true where id = p_driver;
  insert into driver_pauses (driver_id, paused_on, reason)
    values (p_driver, p_paused_on, nullif(btrim(p_reason), ''));
end $$;

create function resume_driver(p_driver uuid, p_resume_on date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  drv profiles%rowtype;
  pz driver_pauses%rowtype;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into drv from profiles where id = p_driver and role = 'driver' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not drv.paused then
    raise exception 'NOT_PAUSED' using errcode = 'P0001';
  end if;
  select * into pz from driver_pauses
   where driver_id = p_driver and resumed_on is null
   order by paused_on desc limit 1;
  if p_resume_on is null
     or p_resume_on <= coalesce(pz.paused_on,
                                (select max(end_date) from driver_periods where driver_id = p_driver),
                                drv.cycle_start_date) then
    raise exception 'INVALID_DATE' using errcode = 'P0001';
  end if;

  perform set_config('passos.resume_driver', 'on', true);
  update profiles set cycle_start_date = p_resume_on, paused = false where id = p_driver;
  perform set_config('passos.resume_driver', '', true);

  if pz.id is not null then
    update driver_pauses set resumed_on = p_resume_on where id = pz.id;
  end if;
end $$;

-- ===== Bloqueios do motorista pausado =====
-- Transfer não é atribuído (nem reatribuído) a motorista pausado; vale para o admin também.
-- Nome "block_paused…" para rodar depois de block_closed_period e antes de rides_before_write.
create function block_paused_assign() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.platform = 'transfer'
     and (tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id
          or old.platform is distinct from 'transfer')
     and exists (select 1 from profiles where id = new.driver_id and paused) then
    raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function block_paused_assign() from public, anon, authenticated;

create trigger block_paused_assign before insert or update on rides
  for each row execute function block_paused_assign();

-- start_shift: igual à 0012, com DRIVER_PAUSED
create or replace function start_shift(p_id uuid, p_car_id uuid, p_odometer int, p_photo text)
returns shifts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  drv profiles%rowtype;
  car cars%rowtype;
  s shifts%rowtype;
  v_last int;
begin
  if not is_active_driver() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_id is not null then
    select * into s from shifts where id = p_id;
    if found then
      if s.driver_id = uid then
        return s;
      end if;
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  -- serializa turnos do mesmo motorista (e com pause_driver)
  select * into drv from profiles where id = uid for update;
  if drv.paused then
    raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
  end if;
  -- serializa inícios no mesmo carro (odômetro mínimo)
  select * into car from cars where id = p_car_id for update;
  if not found or car.ownership <> 'company' or drv.driver_type <> 'company_car' then
    raise exception 'NOT_COMPANY_CAR' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from shifts where driver_id = uid and ended_at is null) then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  v_last := car_last_odometer(car.id);
  if v_last is not null and (p_odometer is null or p_odometer < v_last) then
    raise exception 'ODOMETER_BELOW_LAST' using errcode = 'P0001', detail = v_last::text;
  end if;

  insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_start_photo)
  values (coalesce(p_id, gen_random_uuid()), uid, car.id,
          (now() at time zone 'America/Sao_Paulo')::date, p_odometer, p_photo)
  returning * into s;
  return s;
end $$;

-- start_transfer: igual à 0012, com DRIVER_PAUSED (repetição offline idêntica ainda devolve o existente)
create or replace function start_transfer(p_ride_id uuid, p_odometer int, p_photo text)
returns rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  r rides%rowtype;
  drv profiles%rowtype;
  v_shift shifts%rowtype;
  v_car uuid;
  v_last int;
begin
  if not is_active_driver() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into r from rides
    where id = p_ride_id and driver_id = uid and platform = 'transfer' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if r.transfer_status = 'in_progress' then
    -- repetição (offline) com a mesma leitura devolve o existente
    if r.odometer_start is not distinct from p_odometer then
      return r;
    end if;
    raise exception 'ALREADY_STARTED' using errcode = 'P0001';
  end if;

  select * into drv from profiles where id = uid for share;
  if drv.paused then
    raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
  end if;

  if r.transfer_status <> 'assigned' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;
  if p_odometer is null or p_odometer < 0 then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;

  if drv.driver_type = 'company_car' then
    select * into v_shift from shifts
      where driver_id = uid and ended_at is null
      order by started_at desc limit 1;
    if not found then
      raise exception 'NO_OPEN_SHIFT' using errcode = 'P0001';
    end if;
    v_car := v_shift.car_id;
  else
    v_car := drv.current_car_id;
  end if;

  if v_car is not null then
    -- serializa leituras no mesmo carro (mesmo lock de start_shift)
    perform 1 from cars where id = v_car for update;
    v_last := car_last_odometer(v_car);
    if v_last is not null and p_odometer < v_last then
      raise exception 'ODOMETER_BELOW_LAST' using errcode = 'P0001', detail = v_last::text;
    end if;
  end if;

  perform set_config('passos.transfer_rpc', 'on', true);
  update rides
     set transfer_status = 'in_progress', odometer_start = p_odometer,
         odometer_start_photo = p_photo, started_at = now(), car_id = v_car,
         shift_id = v_shift.id, odometer_end = null, odometer_end_photo = null, km = null
   where id = r.id
   returning * into r;
  perform set_config('passos.transfer_rpc', '', true);
  return r;
end $$;

-- complete_transfer: igual à 0012, com DRIVER_PAUSED
create or replace function complete_transfer(p_ride_id uuid, p_odometer int, p_photo text)
returns rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r rides%rowtype;
begin
  if not is_active_driver() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into r from rides
    where id = p_ride_id and driver_id = auth.uid() and platform = 'transfer' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.transfer_status = 'checked' then
    raise exception 'ALREADY_CHECKED' using errcode = 'P0001';
  end if;
  if r.transfer_status = 'completed' then
    -- repetição (offline) com a mesma leitura devolve o existente
    if r.odometer_end is not distinct from p_odometer then
      return r;
    end if;
    raise exception 'ALREADY_COMPLETED' using errcode = 'P0001';
  end if;
  if exists (select 1 from profiles where id = auth.uid() and paused for share) then
    raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
  end if;
  if r.transfer_status <> 'in_progress' then
    raise exception 'NOT_STARTED' using errcode = 'P0001';
  end if;
  if p_odometer is null or p_odometer < r.odometer_start then
    raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;

  perform set_config('passos.transfer_rpc', 'on', true);
  update rides
     set transfer_status = 'completed', odometer_end = p_odometer, odometer_end_photo = p_photo,
         km = p_odometer - r.odometer_start, reject_reason = null
   where id = r.id
   returning * into r;
  perform set_config('passos.transfer_rpc', '', true);
  return r;
end $$;

-- ===== Privilégios =====
do $$
declare f text;
begin
  foreach f in array array['close_driver_period(uuid,boolean,boolean)', 'mark_statement_paid(uuid,date,text)',
                           'driver_period_signals()', 'pause_driver(uuid,date,text)',
                           'resume_driver(uuid,date)', 'admin_alerts()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
