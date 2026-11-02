-- close_period ganha p_force: fechar a quinzena antes do fim exige confirmação (PERIOD_NOT_ENDED)
drop function close_period(uuid);

create function close_period(p_period uuid, p_force boolean default false) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  per periods%rowtype;
  d uuid;
  n int;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into per from periods where id = p_period for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if per.status = 'closed' then
    raise exception 'ALREADY_CLOSED' using errcode = 'P0001';
  end if;
  -- quinzena ainda em andamento só fecha com confirmação explícita
  if (now() at time zone 'America/Sao_Paulo')::date <= per.end_date and not coalesce(p_force, false) then
    raise exception 'PERIOD_NOT_ENDED' using errcode = 'P0001';
  end if;

  if exists (select 1 from shifts
              where ended_at is null and start_date between per.start_date and per.end_date) then
    raise exception 'OPEN_SHIFTS' using errcode = 'P0001';
  end if;

  if exists (select 1 from rides
              where platform = 'transfer' and transfer_status = 'assigned'
                and ride_date between per.start_date and per.end_date) then
    raise exception 'ASSIGNED_TRANSFERS' using errcode = 'P0001';
  end if;

  if exists (select 1 from fuelings
              where review_status = 'pending'
                and fueled_on between per.start_date and per.end_date)
     or exists (select 1 from ride_expenses e join rides r on r.id = e.ride_id
                 where e.review_status = 'pending'
                   and r.ride_date between per.start_date and per.end_date)
     or exists (select 1 from shifts
                 where review_status = 'pending'
                   and start_date between per.start_date and per.end_date)
     or exists (select 1 from rides
                 where platform = 'transfer' and transfer_status = 'completed'
                   and ride_date between per.start_date and per.end_date) then
    raise exception 'PENDING_REVIEW' using errcode = 'P0001';
  end if;

  if exists (select 1 from shifts
              where ended_at is not null and review_status <> 'approved'
                and start_date between per.start_date and per.end_date) then
    raise exception 'SHIFTS_NOT_APPROVED' using errcode = 'P0001';
  end if;

  for d in select period_movement_drivers(p_period) loop
    if (compute_statement(d, p_period)->>'missing_reference_price')::boolean then
      raise exception 'MISSING_REFERENCE_PRICE' using errcode = 'P0001';
    end if;
  end loop;

  n := 0;
  for d in select period_movement_drivers(p_period) loop
    insert into statements (driver_id, period_id, lines, total)
      values (d, p_period, compute_statement(d, p_period),
              (compute_statement(d, p_period)->>'total')::numeric);
    n := n + 1;
  end loop;

  update periods set status = 'closed', closed_at = now() where id = p_period;
  return n;
end $$;

revoke execute on function close_period(uuid, boolean) from public, anon;
grant execute on function close_period(uuid, boolean) to authenticated;
