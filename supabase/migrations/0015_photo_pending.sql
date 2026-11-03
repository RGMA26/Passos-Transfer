-- 0015: foto do odômetro e print da Uber não bloqueiam mais o turno nem o Transfer.
-- Em produção uma foto que não subia (Blob ilegível no iOS) travava a fila offline inteira e o
-- Transfer ficava "Em andamento" só no aparelho. Agora:
--  * start_shift / end_shift / start_transfer / complete_transfer aceitam a foto nula (ou em branco);
--    o print da Uber deixa de ser exigido no encerramento (UBER_PHOTO_REQUIRED some);
--  * a foto chega depois por attach_photo (só preenche coluna vazia; idempotente);
--  * admin_pendencies() ganha a categoria 'photo' (📷) enquanto faltar foto, fora de quinzena fechada.
-- O app ainda exige as fotos na tela; o nulo só acontece quando o envio da foto falha.

-- start_shift: igual à 0013, sem PHOTO_REQUIRED
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
  if exists (select 1 from shifts where driver_id = uid and ended_at is null) then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  v_last := car_last_odometer(car.id);
  if v_last is not null and (p_odometer is null or p_odometer < v_last) then
    raise exception 'ODOMETER_BELOW_LAST' using errcode = 'P0001', detail = v_last::text;
  end if;

  insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_start_photo)
  values (coalesce(p_id, gen_random_uuid()), uid, car.id,
          (now() at time zone 'America/Sao_Paulo')::date, p_odometer, nullif(btrim(p_photo), ''))
  returning * into s;
  return s;
end $$;

-- end_shift: igual à 0012, sem PHOTO_REQUIRED / UBER_PHOTO_REQUIRED (viram pendência 📷)
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
    if exists (select 1 from rides
                where shift_id = s.id and platform = 'transfer' and transfer_status = 'in_progress') then
      raise exception 'TRANSFER_IN_PROGRESS' using errcode = 'P0001';
    end if;
    if p_odometer is null or p_odometer < s.odometer_start then
      raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
    end if;
    update shifts
      set ended_at = now(), odometer_end = p_odometer, odometer_end_photo = nullif(btrim(p_photo), ''),
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

-- start_transfer: igual à 0013, sem PHOTO_REQUIRED
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
         odometer_start_photo = nullif(btrim(p_photo), ''), started_at = now(), car_id = v_car,
         shift_id = v_shift.id, odometer_end = null, odometer_end_photo = null, km = null
   where id = r.id
   returning * into r;
  perform set_config('passos.transfer_rpc', '', true);
  return r;
end $$;

-- complete_transfer: igual à 0013, sem PHOTO_REQUIRED
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

  perform set_config('passos.transfer_rpc', 'on', true);
  update rides
     set transfer_status = 'completed', odometer_end = p_odometer,
         odometer_end_photo = nullif(btrim(p_photo), ''),
         km = p_odometer - r.odometer_start, reject_reason = null
   where id = r.id
   returning * into r;
  perform set_config('passos.transfer_rpc', '', true);
  return r;
end $$;

-- ===== Anexar a foto que não subiu junto =====
-- Alvos: shift_start | shift_end | shift_uber | transfer_start | transfer_end.
-- Só o motorista dono; path = '<auth.uid()>/<uuid>.jpg' (como o app grava no Storage).
-- Só preenche a coluna se estiver vazia (repetição offline não troca a foto); quinzena fechada →
-- PERIOD_CLOSED (pelo gatilho block_closed_period).
create function attach_photo(p_target text, p_id uuid, p_path text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  s shifts%rowtype;
  r rides%rowtype;
begin
  if not is_active_driver() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_target is null
     or p_target not in ('shift_start', 'shift_end', 'shift_uber', 'transfer_start', 'transfer_end') then
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;
  if p_path is null or p_path !~ ('^' || uid::text || '/[0-9A-Za-z-]+\.jpg$') then
    raise exception 'INVALID_PATH' using errcode = 'P0001';
  end if;

  if p_target like 'shift_%' then
    select * into s from shifts where id = p_id and driver_id = uid for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if p_target = 'shift_start' and s.odometer_start_photo is null then
      update shifts set odometer_start_photo = p_path where id = s.id;
    elsif p_target = 'shift_end' and s.ended_at is not null and s.odometer_end_photo is null then
      update shifts set odometer_end_photo = p_path where id = s.id;
    elsif p_target = 'shift_uber' and s.ended_at is not null and s.uber_earnings_photo is null then
      update shifts set uber_earnings_photo = p_path where id = s.id;
    end if;
    return;
  end if;

  select * into r from rides
    where id = p_id and driver_id = uid and platform = 'transfer' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- o guarda de rides só deixa o motorista mexer nas leituras do Transfer pelas RPCs
  perform set_config('passos.transfer_rpc', 'on', true);
  if p_target = 'transfer_start' and r.odometer_start is not null and r.odometer_start_photo is null then
    update rides set odometer_start_photo = p_path where id = r.id;
  elsif p_target = 'transfer_end' and r.odometer_end is not null and r.odometer_end_photo is null then
    update rides set odometer_end_photo = p_path where id = r.id;
  end if;
  perform set_config('passos.transfer_rpc', '', true);
end $$;

-- ===== Central de pendências: + 'photo' (📷) =====
-- Uma linha por turno/Transfer com o que falta; fora de quinzena fechada (lá não dá mais para anexar).
create or replace function admin_pendencies()
returns table(category text, item_type text, item_id uuid, driver_id uuid, driver_name text,
              label text, occurred_on date)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return query
  select case when f.values_conflict then 'orange' else 'white' end, 'fueling'::text, f.id, f.driver_id, pr.name,
         case when f.values_conflict then 'Abastecimento com valores conflitantes'
              else 'Abastecimento aguardando conferência' end,
         f.fueled_on
    from fuelings f join profiles pr on pr.id = f.driver_id
   where f.review_status = 'pending'
  union all
  select 'white', 'shift', s.id, s.driver_id, pr.name,
         case s.review_status when 'rejected' then 'Turno recusado' else 'Turno aguardando conferência' end,
         s.start_date
    from shifts s join profiles pr on pr.id = s.driver_id
   where s.ended_at is not null and s.review_status in ('pending', 'rejected')
  union all
  select 'white', 'transfer', r.id, r.driver_id, pr.name,
         'Transfer concluído aguardando conferência', r.ride_date
    from rides r join profiles pr on pr.id = r.driver_id
   where r.platform = 'transfer' and r.transfer_status = 'completed';

  return query
  with sig as (select * from driver_period_signals() x where x.signal is not null)
  select 'yellow'::text, 'period'::text, sig.current_period_id, sig.driver_id, sig.name,
         case when sig.days_left = 0 then 'Quinzena termina hoje'
              else 'Quinzena termina em ' || sig.days_left || ' dia(s)' end,
         sig.end_date
    from sig where sig.signal = 'yellow'
  union all
  select 'red', 'period', dp.id, sig.driver_id, sig.name, 'Quinzena terminada e não fechada', dp.end_date
    from sig
    cross join lateral (
      select p.id, p.end_date from driver_periods p
       where p.driver_id = sig.driver_id and p.status = 'open'
         and p.end_date < (now() at time zone 'America/Sao_Paulo')::date
       order by p.start_date limit 1) dp
   where sig.signal = 'red';

  return query
  select 'photo'::text, x.item_type, x.id, x.driver_id, pr.name, x.what || x.missing, x.d
    from (
      select 'shift'::text as item_type, s.id, s.driver_id, s.start_date as d, 'Turno sem '::text as what,
             concat_ws(', ',
               case when s.odometer_start_photo is null then 'foto do odômetro (início)' end,
               case when s.ended_at is not null and s.odometer_end_photo is null then 'foto do odômetro (fim)' end,
               case when s.ended_at is not null and s.uber_earnings_photo is null
                         and exists (select 1 from rides u where u.shift_id = s.id and u.platform = 'uber')
                    then 'print da Uber' end) as missing
        from shifts s
      union all
      select 'transfer', r.id, r.driver_id, r.ride_date, 'Transfer sem ',
             concat_ws(', ',
               case when r.odometer_start is not null and r.odometer_start_photo is null then 'foto do odômetro (início)' end,
               case when r.odometer_end is not null and r.odometer_end_photo is null then 'foto do odômetro (fim)' end)
        from rides r
       where r.platform = 'transfer' and r.transfer_status in ('in_progress', 'completed', 'checked')
    ) x
    join profiles pr on pr.id = x.driver_id
   where x.missing <> ''
     and not exists (select 1 from driver_periods p
                      where p.driver_id = x.driver_id and p.status = 'closed'
                        and x.d between p.start_date and p.end_date)
   order by x.d;
end $$;

-- ===== Privilégios =====
revoke execute on function attach_photo(text, uuid, text) from public, anon;
grant execute on function attach_photo(text, uuid, text) to authenticated;
