-- Código de login: PASSOS + sequência (2 dígitos) + primeiro nome sem acento/maiúsculo
create function generate_login_code(p_name text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  first_name text;
  n bigint;
begin
  first_name := regexp_replace(
    upper(unaccent(split_part(btrim(coalesce(p_name, '')), ' ', 1))),
    '[^A-Z]', '', 'g');
  if first_name = '' then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  n := nextval('driver_seq');
  return 'PASSOS' || case when n < 100 then lpad(n::text, 2, '0') else n::text end || first_name;
end $$;

revoke execute on function generate_login_code(text) from public, anon, authenticated;
grant execute on function generate_login_code(text) to service_role;

-- Snapshots de percentual/consumo e turno automático nas corridas
create function rides_before_write() returns trigger
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
  end if;

  return new;
end $$;

revoke execute on function rides_before_write() from public, anon, authenticated;

create trigger rides_before_write before insert or update on rides
  for each row execute function rides_before_write();

-- Histórico de alterações
create function audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (actor_id, table_name, row_id, action, old_data, new_data)
  values (
    auth.uid(),
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

revoke execute on function audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles','cars','shifts','rides','ride_expenses','fuelings','adjustments','statements','periods']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop;
end $$;
