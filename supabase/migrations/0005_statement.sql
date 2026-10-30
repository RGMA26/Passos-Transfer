-- Preço do litro da quinzena: média dos abastecimentos aprovados do motorista, senão a referência
create function fuel_price_for(p_driver uuid, p_period uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select sum(f.amount) / nullif(sum(f.liters), 0)
       from fuelings f
      where f.driver_id = p_driver
        and f.review_status = 'approved'
        and f.fueled_on between p.start_date and p.end_date),
    p.reference_fuel_price)
  from periods p
  where p.id = p_period
$$;

revoke execute on function fuel_price_for(uuid, uuid) from public, anon, authenticated;

-- Extrato quinzenal do motorista (admin ou o próprio motorista ativo)
create function compute_statement(p_driver uuid, p_period uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per periods%rowtype;
  v_price numeric;
  v_has_fuelings boolean;
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
  v_missing boolean;
begin
  if not (is_admin() or (auth.uid() = p_driver and is_active_driver())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into per from periods where id = p_period;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_price := fuel_price_for(p_driver, p_period);

  -- Uber e Transfer pela data da corrida (BlaBlaCar não gera valor ao motorista)
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
  v_transfer_fuel := round(v_transfer_fuel * coalesce(per.reference_fuel_price, 0), 2);

  -- Abastecimentos
  select coalesce(sum(amount) filter (where review_status = 'approved'), 0),
         coalesce(sum(amount) filter (where review_status = 'pending'), 0),
         count(*) filter (where review_status = 'approved') > 0
    into v_fuel, v_pending_fuel, v_has_fuelings
    from fuelings
   where driver_id = p_driver
     and fueled_on between per.start_date and per.end_date;

  -- Pedágio/estacionamento de transfers concluídos/conferidos da quinzena
  select coalesce(sum(e.amount) filter (where e.review_status = 'approved'), 0),
         coalesce(sum(e.amount) filter (where e.review_status = 'pending'), 0)
    into v_expense, v_pending_exp
    from ride_expenses e
    join rides r on r.id = e.ride_id
   where r.driver_id = p_driver and r.platform = 'transfer'
     and r.transfer_status in ('completed', 'checked')
     and r.ride_date between per.start_date and per.end_date;

  -- km por turno encerrado iniciado na quinzena
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
   where driver_id = p_driver and period_id = p_period;

  v_missing := per.reference_fuel_price is null
    and (v_own_km > 0 or (v_km_off > 0 and not v_has_fuelings));

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
    'missing_reference_price', v_missing,
    'km', jsonb_build_object('total', v_km_total, 'service', v_km_service, 'off', v_km_off),
    'pending', jsonb_build_object('fuelings', v_pending_fuel, 'expenses', v_pending_exp));
end $$;

revoke execute on function compute_statement(uuid, uuid) from public, anon;
grant execute on function compute_statement(uuid, uuid) to authenticated;

-- end_shift: agora estima o desconto de gasolina por fora (mesma assinatura e regras)
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
  -- statement separado: period_for_date pode criar a quinzena, e fuel_price_for (stable)
  -- só a enxerga num snapshot posterior
  v_period := period_for_date(s.start_date);
  v_price := fuel_price_for(s.driver_id, v_period);
  return jsonb_build_object(
    'km_total', v_total,
    'km_service', v_service,
    'km_off', v_off,
    'off_discount_estimate', round(v_off / s.consumption_km_l * v_price, 2));
end $$;

-- complete_transfer: carro da empresa exige turno aberto e liga o transfer a ele
-- (km em serviço do turno = Uber + BlaBlaCar + Transfer); carro próprio fica sem turno.
-- Se o transfer já tem shift_id, ele é mantido e não se exige turno aberto.
create or replace function complete_transfer(p_ride_id uuid, p_km numeric)
returns rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r rides%rowtype;
  v_type text;
  v_shift uuid;
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
  if p_km is null or p_km < 0 then
    raise exception 'INVALID_KM' using errcode = 'P0001';
  end if;

  -- já ligado a um turno (reenvio após recusa ou repetição): mantém o turno original
  -- (só se o turno for do próprio motorista; senão trata como sem turno)
  select id into v_shift from shifts where id = r.shift_id and driver_id = r.driver_id;
  select driver_type into v_type from profiles where id = r.driver_id;
  if v_shift is null and v_type = 'company_car' then
    select id into v_shift from shifts
      where driver_id = r.driver_id and ended_at is null
      order by started_at desc limit 1;
    if v_shift is null then
      raise exception 'NO_OPEN_SHIFT' using errcode = 'P0001';
    end if;
  end if;

  update rides set km = p_km, transfer_status = 'completed', reject_reason = null,
                   shift_id = v_shift
    where id = r.id
    returning * into r;
  return r;
end $$;

-- rides_before_write: igual à 0002, mais: transfer reatribuído a outro motorista perde o shift_id
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
    new.consumption_km_l := null;
    if new.platform = 'transfer' and drv.driver_type = 'own_car' then
      select c.consumption_km_l into new.consumption_km_l
        from cars c where c.id = drv.current_car_id;
    end if;
  else
    -- snapshots imutáveis: ninguém edita por corrida
    new.driver_pct := old.driver_pct;
    new.consumption_km_l := old.consumption_km_l;
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
