-- Fechamento de quinzena, pagamento, alertas e resumo (somente admin)

-- Motoristas com movimento na quinzena (corrida, turno, abastecimento ou ajuste)
create function period_movement_drivers(p_period uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.driver_id from rides r, periods p
   where p.id = p_period and r.ride_date between p.start_date and p.end_date
  union
  select s.driver_id from shifts s, periods p
   where p.id = p_period and s.start_date between p.start_date and p.end_date
  union
  select f.driver_id from fuelings f, periods p
   where p.id = p_period and f.fueled_on between p.start_date and p.end_date
  union
  select a.driver_id from adjustments a where a.period_id = p_period
$$;

revoke execute on function period_movement_drivers(uuid) from public, anon, authenticated;

-- Imutabilidade dos extratos: só o pagamento pode mudar; nunca apagar
create function statements_freeze() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'STATEMENT_FROZEN' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'paid_at' - 'payment_method') is distinct from
     (to_jsonb(old) - 'paid_at' - 'payment_method') then
    raise exception 'STATEMENT_FROZEN' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function statements_freeze() from public, anon, authenticated;

create trigger statements_freeze before update or delete on statements
  for each row execute function statements_freeze();

-- Quinzena fechada não muda mais (datas, preço de referência, status)
create function periods_freeze() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'closed' then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function periods_freeze() from public, anon, authenticated;

create trigger periods_freeze before update or delete on periods
  for each row execute function periods_freeze();

-- Fecha a quinzena: valida pendências e congela um extrato por motorista com movimento
create function close_period(p_period uuid) returns int
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

create function mark_statement_paid(p_statement uuid, p_paid_at date, p_method text)
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

create function admin_alerts()
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
     where not exists (select 1 from periods p
                        where p.status = 'closed'
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

create function period_summary(p_period uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  per periods%rowtype;
  v_uber numeric;
  v_transfer numeric;
  v_blabla numeric;
  v_drivers numeric := 0;
  v_fuel_reimb numeric := 0;
  v_fuel_disc numeric := 0;
  v_rank jsonb;
  v_lines jsonb;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into per from periods where id = p_period;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount) filter (where platform = 'uber'), 0),
         coalesce(sum(amount) filter (where platform = 'transfer'
                                        and transfer_status in ('completed', 'checked')), 0),
         coalesce(sum(amount) filter (where platform = 'blablacar'), 0)
    into v_uber, v_transfer, v_blabla
    from rides
   where ride_date between per.start_date and per.end_date;

  -- [{driver_id, j}]: extratos congelados se fechada, senão calculados agora
  if per.status = 'closed' then
    select coalesce(jsonb_agg(jsonb_build_object('driver_id', driver_id, 'j', lines)), '[]'::jsonb)
      into v_lines from statements where period_id = p_period;
  else
    select coalesce(jsonb_agg(jsonb_build_object('driver_id', m.d,
                                                 'j', compute_statement(m.d, p_period))), '[]'::jsonb)
      into v_lines from (select period_movement_drivers(p_period) as d) m;
  end if;

  select coalesce(sum((e->'j'->>'uber_share')::numeric + (e->'j'->>'transfer_share')::numeric), 0),
         coalesce(sum((e->'j'->>'fuel_reimbursement')::numeric
                      + (e->'j'->>'transfer_fuel_reimbursement')::numeric), 0),
         coalesce(sum((e->'j'->>'off_duty_fuel_discount')::numeric), 0)
    into v_drivers, v_fuel_reimb, v_fuel_disc
    from jsonb_array_elements(v_lines) e;

  select coalesce(jsonb_agg(jsonb_build_object(
           'driver_id', x.driver_id, 'name', x.name, 'km_off', x.km_off)
           order by x.km_off desc, x.name), '[]'::jsonb)
    into v_rank
    from (select (e->>'driver_id')::uuid as driver_id, p.name,
                 (e->'j'->'km'->>'off')::numeric as km_off
            from jsonb_array_elements(v_lines) e
            join profiles p on p.id = (e->>'driver_id')::uuid) x
   where x.km_off > 0;

  return jsonb_build_object(
    'revenue', jsonb_build_object('uber', round(v_uber, 2), 'transfer', round(v_transfer, 2),
                                  'blablacar', round(v_blabla, 2)),
    'drivers_share', round(v_drivers, 2),
    'company_share', round(v_uber + v_transfer + v_blabla - v_drivers, 2),
    'fuel_reimbursed', round(v_fuel_reimb, 2),
    'fuel_discounted', round(v_fuel_disc, 2),
    'off_km_ranking', v_rank);
end $$;

do $$
declare f text;
begin
  foreach f in array array['close_period(uuid)', 'mark_statement_paid(uuid,date,text)',
                           'admin_alerts()', 'period_summary(uuid)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
