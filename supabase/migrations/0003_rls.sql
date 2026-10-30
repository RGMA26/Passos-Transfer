-- Endurecimento de period_for_date (cria quinzenas; só usuários logados)
alter function period_for_date(date) set search_path = public, pg_temp;
revoke execute on function period_for_date(date) from public, anon;
grant execute on function period_for_date(date) to authenticated;

-- Índices
create index rides_driver_date_idx on rides (driver_id, ride_date);
create index rides_shift_idx on rides (shift_id);
create index shifts_driver_start_idx on shifts (driver_id, start_date);
create index fuelings_driver_date_idx on fuelings (driver_id, fueled_on);
create index ride_expenses_ride_idx on ride_expenses (ride_id);
create index adjustments_driver_period_idx on adjustments (driver_id, period_id);
create index statements_period_idx on statements (period_id);

-- Helpers de papel (security definer: evitam recursão de RLS em profiles)
create function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin' and active
  )
$$;

create function is_active_driver() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'driver' and active
  )
$$;

revoke execute on function is_admin() from public, anon;
revoke execute on function is_active_driver() from public, anon;
grant execute on function is_admin() to authenticated, service_role;
grant execute on function is_active_driver() to authenticated, service_role;

-- Bloqueio de quinzena fechada (vale para admin também)
create function row_in_closed_period(p_table text, r jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d date;
begin
  case p_table
    when 'rides' then d := (r->>'ride_date')::date;
    when 'fuelings' then d := (r->>'fueled_on')::date;
    when 'shifts' then d := (r->>'start_date')::date;
    when 'ride_expenses' then
      select ride_date into d from rides where id = (r->>'ride_id')::uuid;
    when 'adjustments' then
      return exists (select 1 from periods
        where id = (r->>'period_id')::uuid and status = 'closed');
    else
      return false;
  end case;
  if d is null then
    return false;
  end if;
  return exists (select 1 from periods
    where status = 'closed' and d between start_date and end_date);
end $$;

create function block_closed_period() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
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

-- Nome começa com "block" para rodar antes de rides_before_write
do $$
declare t text;
begin
  foreach t in array array['rides','fuelings','shifts','ride_expenses','adjustments']
  loop
    execute format('create trigger block_closed_period before insert or update or delete on %1$I for each row execute function block_closed_period()', t);
  end loop;
end $$;

-- Só admin altera review_status / reject_reason (auth.uid() nulo = service role / manutenção)
create function protect_review_fields() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and (new.review_status is distinct from old.review_status
          or new.reject_reason is distinct from old.reject_reason)
     and not is_admin() then
    raise exception 'FORBIDDEN_FIELD' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function protect_review_fields() from public, anon, authenticated;

create trigger protect_review_fields before update on fuelings
  for each row execute function protect_review_fields();
create trigger protect_review_fields before update on ride_expenses
  for each row execute function protect_review_fields();
create trigger protect_review_fields before update on shifts
  for each row execute function protect_review_fields();

-- RLS
alter table profiles enable row level security;
alter table cars enable row level security;
alter table periods enable row level security;
alter table shifts enable row level security;
alter table rides enable row level security;
alter table ride_expenses enable row level security;
alter table fuelings enable row level security;
alter table adjustments enable row level security;
alter table statements enable row level security;
alter table audit_log enable row level security;

-- Admin: tudo (audit_log: só leitura)
do $$
declare t text;
begin
  foreach t in array array['profiles','cars','periods','shifts','rides','ride_expenses','fuelings','adjustments','statements']
  loop
    execute format('create policy admin_all on %1$I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

create policy admin_select on audit_log for select to authenticated using (is_admin());

-- profiles / cars / periods
create policy driver_select_own on profiles for select to authenticated
  using (id = auth.uid());

create policy driver_select_current on cars for select to authenticated
  using (
    is_active_driver()
    and (current_driver_id = auth.uid()
         or id = (select current_car_id from profiles where id = auth.uid()))
  );

create policy driver_select on periods for select to authenticated
  using (is_active_driver());

-- leitura própria
create policy driver_select_own on shifts for select to authenticated
  using (is_active_driver() and driver_id = auth.uid());
create policy driver_select_own on rides for select to authenticated
  using (is_active_driver() and driver_id = auth.uid());
create policy driver_select_own on fuelings for select to authenticated
  using (is_active_driver() and driver_id = auth.uid());
create policy driver_select_own on adjustments for select to authenticated
  using (is_active_driver() and driver_id = auth.uid());
create policy driver_select_own on statements for select to authenticated
  using (is_active_driver() and driver_id = auth.uid());
create policy driver_select_own on ride_expenses for select to authenticated
  using (is_active_driver() and exists (
    select 1 from rides r where r.id = ride_id and r.driver_id = auth.uid()));

-- rides: só uber/blablacar (transfer e turnos via RPC)
create policy driver_insert on rides for insert to authenticated
  with check (is_active_driver() and driver_id = auth.uid()
              and platform in ('uber','blablacar'));
create policy driver_update on rides for update to authenticated
  using (is_active_driver() and driver_id = auth.uid() and platform in ('uber','blablacar')
    and not exists (select 1 from shifts s where s.id = rides.shift_id and s.review_status <> 'pending'))
  with check (is_active_driver() and driver_id = auth.uid() and platform in ('uber','blablacar')
    and not exists (select 1 from shifts s where s.id = rides.shift_id and s.review_status <> 'pending'));
create policy driver_delete on rides for delete to authenticated
  using (is_active_driver() and driver_id = auth.uid() and platform in ('uber','blablacar')
    and not exists (select 1 from shifts s where s.id = rides.shift_id and s.review_status <> 'pending'));

-- fuelings: insere pendente; edita/apaga só pendente
create policy driver_insert on fuelings for insert to authenticated
  with check (is_active_driver() and driver_id = auth.uid()
              and review_status = 'pending' and reject_reason is null);
create policy driver_update on fuelings for update to authenticated
  using (is_active_driver() and driver_id = auth.uid() and review_status = 'pending')
  with check (is_active_driver() and driver_id = auth.uid() and review_status = 'pending');
create policy driver_delete on fuelings for delete to authenticated
  using (is_active_driver() and driver_id = auth.uid() and review_status = 'pending');

-- ride_expenses: só do próprio transfer atribuído/concluído
create policy driver_insert on ride_expenses for insert to authenticated
  with check (
    is_active_driver()
    and review_status = 'pending' and reject_reason is null
    and exists (
      select 1 from rides r
      where r.id = ride_id and r.driver_id = auth.uid()
        and r.platform = 'transfer'
        and r.transfer_status in ('assigned','completed'))
  );
create policy driver_update on ride_expenses for update to authenticated
  using (is_active_driver() and review_status = 'pending' and exists (
    select 1 from rides r where r.id = ride_id and r.driver_id = auth.uid()))
  with check (
    is_active_driver() and review_status = 'pending' and reject_reason is null
    and exists (
      select 1 from rides r
      where r.id = ride_id and r.driver_id = auth.uid()
        and r.platform = 'transfer'
        and r.transfer_status in ('assigned','completed'))
  );
create policy driver_delete on ride_expenses for delete to authenticated
  using (is_active_driver() and review_status = 'pending' and exists (
    select 1 from rides r where r.id = ride_id and r.driver_id = auth.uid()));

-- Storage: bucket privado, pasta por motorista
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict do nothing;

create policy photos_driver_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and is_active_driver()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_driver_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and is_active_driver()
         and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_driver_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and is_active_driver()
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and is_active_driver()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and is_admin());
