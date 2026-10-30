-- Motivo da recusa de transfer (devolvido ao motorista para refazer)
alter table rides add column reject_reason text;

-- Turno recusado reabre as corridas para o motorista corrigir (só turno aprovado trava)
drop policy driver_update on rides;
drop policy driver_delete on rides;
create policy driver_update on rides for update to authenticated
  using (is_active_driver() and driver_id = auth.uid() and platform in ('uber','blablacar')
    and not exists (select 1 from shifts s where s.id = rides.shift_id and s.review_status = 'approved'))
  with check (is_active_driver() and driver_id = auth.uid() and platform in ('uber','blablacar')
    and not exists (select 1 from shifts s where s.id = rides.shift_id and s.review_status = 'approved'));
create policy driver_delete on rides for delete to authenticated
  using (is_active_driver() and driver_id = auth.uid() and platform in ('uber','blablacar')
    and not exists (select 1 from shifts s where s.id = rides.shift_id and s.review_status = 'approved'));

-- Iniciar turno (idempotente por p_id)
create function start_shift(p_id uuid, p_car_id uuid, p_odometer int, p_photo text)
returns shifts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  drv profiles%rowtype;
  car cars%rowtype;
  s shifts%rowtype;
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
  select * into car from cars where id = p_car_id;
  if not found or car.ownership <> 'company' or drv.driver_type <> 'company_car' then
    raise exception 'NOT_COMPANY_CAR' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from shifts where driver_id = uid and ended_at is null) then
    raise exception 'SHIFT_ALREADY_OPEN' using errcode = 'P0001';
  end if;

  insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start, odometer_start_photo)
  values (coalesce(p_id, gen_random_uuid()), uid, car.id, car.consumption_km_l,
          (now() at time zone 'America/Sao_Paulo')::date, p_odometer, p_photo)
  returning * into s;
  return s;
end $$;

-- Encerrar turno (idempotente: turno já encerrado devolve o resultado guardado)
create function end_shift(p_shift_id uuid, p_odometer int, p_photo text, p_uber_photo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s shifts%rowtype;
  v_total int;
  v_service numeric;
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
  select coalesce(sum(km), 0) into v_service from rides where shift_id = s.id;
  return jsonb_build_object(
    'km_total', v_total,
    'km_service', v_service,
    'km_off', v_total - v_service,
    'off_discount_estimate', null);
end $$;

-- Concluir transfer (motorista dono)
create function complete_transfer(p_ride_id uuid, p_km numeric)
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
  if p_km is null or p_km < 0 then
    raise exception 'INVALID_KM' using errcode = 'P0001';
  end if;

  update rides set km = p_km, transfer_status = 'completed', reject_reason = null
    where id = r.id
    returning * into r;
  return r;
end $$;

-- Conferência (admin)
create function review_item(p_kind text, p_id uuid, p_approved boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_approved boolean := coalesce(p_approved, false);
  v_reason text := case when coalesce(p_approved, false) then null else nullif(btrim(p_reason), '') end;
  v_status text := case when coalesce(p_approved, false) then 'approved' else 'rejected' end;
  v_found boolean;
  v_tstatus text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('fueling','expense','shift','transfer') then
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;
  if not v_approved and v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_kind = 'fueling' then
    update fuelings set review_status = v_status, reject_reason = v_reason where id = p_id;
    v_found := found;
  elsif p_kind = 'expense' then
    update ride_expenses set review_status = v_status, reject_reason = v_reason where id = p_id;
    v_found := found;
  elsif p_kind = 'shift' then
    update shifts set review_status = v_status, reject_reason = v_reason where id = p_id;
    v_found := found;
  else
    select transfer_status into v_tstatus from rides
      where id = p_id and platform = 'transfer' for update;
    v_found := found;
    if v_found then
      if v_tstatus is distinct from 'completed' then
        raise exception 'NOT_REVIEWABLE' using errcode = 'P0001';
      end if;
      update rides
        set transfer_status = case when v_approved then 'checked' else 'assigned' end,
            reject_reason = v_reason
        where id = p_id;
    end if;
  end if;

  if not v_found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

create function clear_must_change_password() returns void
language sql security definer set search_path = public, pg_temp as $$
  update profiles set must_change_password = false where id = auth.uid();
$$;

revoke execute on function start_shift(uuid, uuid, int, text) from public, anon;
revoke execute on function end_shift(uuid, int, text, text) from public, anon;
revoke execute on function complete_transfer(uuid, numeric) from public, anon;
revoke execute on function review_item(text, uuid, boolean, text) from public, anon;
revoke execute on function clear_must_change_password() from public, anon;
grant execute on function start_shift(uuid, uuid, int, text) to authenticated;
grant execute on function end_shift(uuid, int, text, text) to authenticated;
grant execute on function complete_transfer(uuid, numeric) to authenticated;
grant execute on function review_item(text, uuid, boolean, text) to authenticated;
grant execute on function clear_must_change_password() to authenticated;
