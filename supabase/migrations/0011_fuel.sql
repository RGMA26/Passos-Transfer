-- Combustível por tipo, custo por km, conflito de valores e odômetro mínimo (spec §3 e §9.1).
-- O consumo deixa de ser snapshot em turnos/corridas: o custo por km da quinzena já o embute
-- (Σ valor ÷ Σ km equivalente das notas aprovadas). Removidos: cars/shifts/rides.consumption_km_l,
-- fuelings.liters (vira quantity) e fuel_price_for (vira cost_per_km_for).

-- ===== Funções que liam consumption_km_l (recriadas antes de remover as colunas) =====

-- rides_before_write: igual à 0005, sem o snapshot de consumo
create or replace function rides_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  drv profiles%rowtype;
  open_shift uuid;
  assigned_changed boolean;
begin
  assigned_changed := tg_op = 'INSERT'
    or new.driver_id is distinct from old.driver_id
    or new.platform is distinct from old.platform;
  select * into drv from profiles where id = new.driver_id;

  if assigned_changed then
    new.driver_pct := case new.platform
      when 'uber' then drv.uber_pct
      when 'transfer' then drv.transfer_pct
      else null end;
  else
    -- snapshot imutável: ninguém edita por corrida
    new.driver_pct := old.driver_pct;
  end if;

  if new.platform in ('uber', 'blablacar') then
    if drv.driver_type = 'own_car' then
      raise exception 'PLATFORM_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and new.driver_id is distinct from old.driver_id
       and new.shift_id is not distinct from old.shift_id then
      new.shift_id := null;
    end if;
    if new.shift_id is null then
      select id into open_shift from shifts
        where driver_id = new.driver_id and ended_at is null
        order by started_at desc limit 1;
    elsif tg_op = 'INSERT' or new.shift_id is distinct from old.shift_id then
      select id into open_shift from shifts
        where id = new.shift_id and driver_id = new.driver_id and ended_at is null;
    else
      -- edição simples: o turno pode já ter sido encerrado, só confere o dono
      select id into open_shift from shifts
        where id = new.shift_id and driver_id = new.driver_id;
    end if;
    if open_shift is null then
      raise exception 'NO_OPEN_SHIFT' using errcode = 'P0001';
    end if;
    new.shift_id := open_shift;
  elsif new.platform = 'transfer' and tg_op = 'UPDATE'
        and new.driver_id is distinct from old.driver_id then
    -- transfer reatribuído: solta o turno do motorista anterior
    new.shift_id := null;
  end if;

  return new;
end $$;

-- start_shift: igual à 0004, sem snapshot de consumo e com odômetro mínimo do carro
-- (maior odometer_start/odometer_end dos turnos do carro; a Task 3 inclui os Transfers).
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

  -- serializa turnos do mesmo motorista
  select * into drv from profiles where id = uid for update;
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

  select max(greatest(odometer_start, coalesce(odometer_end, odometer_start))) into v_last
    from shifts where car_id = car.id;
  if v_last is not null and p_odometer < v_last then
    raise exception 'ODOMETER_BELOW_LAST' using errcode = 'P0001', detail = v_last::text;
  end if;

  insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_start_photo)
  values (coalesce(p_id, gen_random_uuid()), uid, car.id,
          (now() at time zone 'America/Sao_Paulo')::date, p_odometer, p_photo)
  returning * into s;
  return s;
end $$;

alter table rides drop column consumption_km_l;
alter table shifts drop column consumption_km_l;

-- ===== Carros: tipo de combustível e consumos (todos opcionais) =====
alter table cars
  add column fuel_type text not null default 'flex'
    check (fuel_type in ('gnv','diesel','gasolina','alcool','flex','eletrico','hibrido')),
  add column km_per_l_gasolina numeric(6,2) check (km_per_l_gasolina > 0),
  add column km_per_l_alcool numeric(6,2) check (km_per_l_alcool > 0),
  add column km_per_l_diesel numeric(6,2) check (km_per_l_diesel > 0),
  add column km_per_m3_gnv numeric(6,2) check (km_per_m3_gnv > 0),
  add column km_per_kwh numeric(6,2) check (km_per_kwh > 0);

-- linhas existentes: flex, com o consumo antigo como gasolina; carros novos escolhem o tipo
update cars set km_per_l_gasolina = consumption_km_l;
alter table cars alter column fuel_type drop default;
alter table cars drop column consumption_km_l;

-- Consumo do carro para um combustível (nulo se não cadastrado). Interno.
create function car_consumption(p_car uuid, p_fuel text) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_fuel
           when 'gasolina' then c.km_per_l_gasolina
           when 'alcool' then c.km_per_l_alcool
           when 'diesel' then c.km_per_l_diesel
           when 'gnv' then c.km_per_m3_gnv
           when 'eletrico' then c.km_per_kwh
         end
    from cars c where c.id = p_car
$$;

revoke execute on function car_consumption(uuid, text) from public, anon, authenticated;

-- ===== Abastecimentos: combustível, quantidade, preço por unidade, conflito, km equivalente =====
alter table fuelings rename column liters to quantity;
alter table fuelings drop constraint fuelings_liters_check;
alter table fuelings alter column quantity type numeric(8,3);
alter table fuelings add constraint fuelings_quantity_check check (quantity > 0);

alter table fuelings
  add column fuel text check (fuel in ('gasolina','alcool','diesel','gnv','eletrico')),
  add column unit_price numeric(7,3) check (unit_price > 0),
  add column values_conflict boolean not null default false,
  add column km_equivalent numeric;

-- linhas existentes (não há em produção): gasolina e preço = total ÷ litros
alter table fuelings disable trigger block_closed_period;
update fuelings f
   set fuel = case c.fuel_type when 'flex' then 'gasolina' when 'hibrido' then 'gasolina' else c.fuel_type end,
       unit_price = greatest(round(f.amount / f.quantity, 3), 0.001),
       km_equivalent = round(f.quantity * c.km_per_l_gasolina, 3)
  from cars c where c.id = f.car_id;
alter table fuelings enable trigger block_closed_period;

alter table fuelings
  alter column fuel set not null,
  alter column unit_price set not null;

-- Calcula sempre values_conflict e km_equivalent (exibição; ninguém grava à mão), confere o
-- combustível e o carro (motorista: só o carro atual → FUEL_CAR_NOT_ALLOWED).
create function fuelings_fuel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text;
begin
  -- compatibilidade só quando o combustível/carro é informado (a conferência não esbarra
  -- numa troca posterior do tipo do carro); km_equivalent usa o consumo atual a cada escrita
  select fuel_type into v_type from cars where id = new.car_id;
  -- o motorista só lança abastecimento do carro atual dele (admin não é barrado)
  if (tg_op = 'INSERT' or new.car_id is distinct from old.car_id)
     and auth.uid() is not null and auth.uid() = new.driver_id and not is_admin()
     and new.car_id is distinct from (select current_car_id from profiles where id = new.driver_id) then
    raise exception 'FUEL_CAR_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if (tg_op = 'INSERT' or new.fuel is distinct from old.fuel or new.car_id is distinct from old.car_id)
     and (v_type is null or not (
       new.fuel = v_type
       or (v_type = 'flex' and new.fuel in ('gasolina', 'alcool'))
       or (v_type = 'hibrido' and new.fuel in ('gasolina', 'eletrico')))) then
    raise exception 'FUEL_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  new.values_conflict :=
    abs(new.quantity * new.unit_price - new.amount) > greatest(0.10, 0.005 * new.amount);
  new.km_equivalent := round(new.quantity * car_consumption(new.car_id, new.fuel), 3);
  return new;
end $$;

revoke execute on function fuelings_fuel() from public, anon, authenticated;

create trigger fuelings_fuel before insert or update on fuelings
  for each row execute function fuelings_fuel();

-- ===== Custo por km =====
-- O km de cada nota é calculado na hora (quantity × consumo ATUAL do carro da nota): consumo
-- cadastrado/alterado depois vale para as notas já lançadas. fuelings.km_equivalent é só exibição.
-- 1) quinzena: Σ valor ÷ Σ km das notas aprovadas do motorista com consumo;
--    notas aprovadas na quinzena mas nenhuma com consumo → missing_consumption (sem reserva);
-- 2) última nota aprovada do motorista (fueled_on ≤ fim) com consumo;
-- 3) última nota aprovada da empresa (fueled_on ≤ fim) com consumo; senão nulo.
create function cost_per_km_for(p_driver uuid, p_period uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_amount numeric;
  v_km numeric;
  v_count int;
  v_cost numeric;
begin
  select * into per from driver_periods where id = p_period and driver_id = p_driver;
  if not found then
    return jsonb_build_object('cost_per_km', null, 'source', null, 'missing_consumption', false);
  end if;

  select sum(f.amount) filter (where k.km > 0),
         sum(k.km) filter (where k.km > 0),
         count(*)
    into v_amount, v_km, v_count
    from fuelings f
    cross join lateral (select f.quantity * car_consumption(f.car_id, f.fuel) as km) k
   where f.driver_id = p_driver and f.review_status = 'approved'
     and f.fueled_on between per.start_date and per.end_date;
  if v_km > 0 then
    return jsonb_build_object('cost_per_km', v_amount / v_km, 'source', 'period',
                              'missing_consumption', false);
  end if;
  if v_count > 0 then
    return jsonb_build_object('cost_per_km', null, 'source', null, 'missing_consumption', true);
  end if;

  select f.amount / k.km into v_cost
    from fuelings f
    cross join lateral (select f.quantity * car_consumption(f.car_id, f.fuel) as km) k
   where f.driver_id = p_driver and f.review_status = 'approved' and k.km > 0
     and f.fueled_on <= per.end_date
   order by f.fueled_on desc, f.created_at desc, f.id desc limit 1;
  if v_cost is not null then
    return jsonb_build_object('cost_per_km', v_cost, 'source', 'driver_last',
                              'missing_consumption', false);
  end if;

  select f.amount / k.km into v_cost
    from fuelings f
    cross join lateral (select f.quantity * car_consumption(f.car_id, f.fuel) as km) k
   where f.review_status = 'approved' and k.km > 0
     and f.fueled_on <= per.end_date
   order by f.fueled_on desc, f.created_at desc, f.id desc limit 1;
  if v_cost is not null then
    return jsonb_build_object('cost_per_km', v_cost, 'source', 'company_last',
                              'missing_consumption', false);
  end if;

  return jsonb_build_object('cost_per_km', null, 'source', null, 'missing_consumption', false);
end $$;

revoke execute on function cost_per_km_for(uuid, uuid) from public, anon, authenticated;

drop function if exists fuel_price_for(uuid, uuid);

-- ===== Extrato =====
-- Reembolso de abastecimento só para carro da empresa (tipo no momento do cálculo).
-- Gasolina dos Transfers (carro próprio) e desconto por fora = km × custo por km.
create or replace function compute_statement(p_driver uuid, p_period uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per driver_periods%rowtype;
  v_type text;
  v_cpk jsonb;
  v_cost numeric;
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
  v_discount numeric;
  v_adjust numeric;
  v_needed boolean;
begin
  if not (is_admin() or (auth.uid() = p_driver and is_active_driver())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into per from driver_periods where id = p_period and driver_id = p_driver;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select driver_type into v_type from profiles where id = p_driver;
  v_cpk := cost_per_km_for(p_driver, p_period);
  v_cost := (v_cpk->>'cost_per_km')::numeric;

  select round(coalesce(sum(amount * driver_pct / 100), 0), 2) into v_uber
    from rides
   where driver_id = p_driver and platform = 'uber'
     and ride_date between per.start_date and per.end_date;

  select round(coalesce(sum(amount * driver_pct / 100), 0), 2),
         coalesce(sum(km), 0)
    into v_transfer, v_own_km
    from rides
   where driver_id = p_driver and platform = 'transfer'
     and transfer_status in ('completed', 'checked')
     and ride_date between per.start_date and per.end_date;
  if v_type is distinct from 'own_car' then
    v_own_km := 0;
  end if;
  v_transfer_fuel := round(v_own_km * coalesce(v_cost, 0), 2);

  select coalesce(sum(amount) filter (where review_status = 'approved'), 0),
         coalesce(sum(amount) filter (where review_status = 'pending'), 0)
    into v_fuel, v_pending_fuel
    from fuelings
   where driver_id = p_driver
     and fueled_on between per.start_date and per.end_date;
  if v_type is distinct from 'company_car' then
    v_fuel := 0;
  end if;

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
         coalesce(sum(t.km_off), 0)
    into v_km_total, v_km_service, v_km_off
    from (
      select s.odometer_end - s.odometer_start as km_total,
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
  v_discount := round(v_km_off * coalesce(v_cost, 0), 2);

  select coalesce(sum(amount), 0) into v_adjust
    from adjustments
   where driver_id = p_driver and driver_period_id = p_period;

  v_needed := v_own_km > 0 or v_km_off > 0;

  return jsonb_build_object(
    'uber_share', v_uber,
    'transfer_share', v_transfer,
    'fuel_reimbursement', v_fuel,
    'transfer_fuel_reimbursement', v_transfer_fuel,
    'expense_reimbursement', v_expense,
    'off_duty_fuel_discount', v_discount,
    'adjustments', v_adjust,
    'total', v_uber + v_transfer + v_fuel + v_transfer_fuel + v_expense - v_discount + v_adjust,
    'cost_per_km', round(v_cost, 4),
    'missing_consumption', v_needed and (v_cpk->>'missing_consumption')::boolean,
    'missing_fuel_price', v_needed and v_cost is null
                          and not (v_cpk->>'missing_consumption')::boolean,
    'km', jsonb_build_object('total', v_km_total, 'service', v_km_service, 'off', v_km_off),
    'pending', jsonb_build_object('fuelings', v_pending_fuel, 'expenses', v_pending_exp));
end $$;

revoke execute on function compute_statement(uuid, uuid) from public, anon;
grant execute on function compute_statement(uuid, uuid) to authenticated;

-- end_shift: estimativa do desconto = km por fora × custo por km da quinzena (nulo sem custo)
create or replace function end_shift(p_shift_id uuid, p_odometer int, p_photo text, p_uber_photo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s shifts%rowtype;
  v_total int;
  v_service numeric;
  v_off numeric;
  v_cost numeric;
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
  -- statement separado: a quinzena pode ser criada aqui e cost_per_km_for (stable)
  -- só a enxerga num snapshot posterior
  v_period := driver_period_for(s.driver_id, s.start_date);
  v_cost := (cost_per_km_for(s.driver_id, v_period)->>'cost_per_km')::numeric;
  return jsonb_build_object(
    'km_total', v_total,
    'km_service', v_service,
    'km_off', v_off,
    'off_discount_estimate', round(v_off * v_cost, 2));
end $$;
