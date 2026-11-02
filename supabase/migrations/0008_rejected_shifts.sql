-- Turno recusado tem efeito:
--  1) a quinzena não fecha enquanto houver turno encerrado não aprovado (SHIFTS_NOT_APPROVED);
--  2) quando o motorista corrige (insere/edita/apaga) uma corrida de um turno recusado,
--     o turno volta para 'pending' e reaparece na conferência.

-- O guarda continua barrando o motorista; a única exceção é a reabertura feita pelo
-- gatilho abaixo (flag de sessão local à transação), e só no sentido rejected → pending.
create or replace function protect_review_fields() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null
     and (new.review_status is distinct from old.review_status
          or new.reject_reason is distinct from old.reject_reason)
     and not is_admin()
     and not (tg_table_name = 'shifts'
              and coalesce(current_setting('passos.reopen_shift', true), '') = 'on'
              and old.review_status = 'rejected'
              and new.review_status = 'pending'
              and new.reject_reason is null) then
    raise exception 'FORBIDDEN_FIELD' using errcode = 'P0001';
  end if;
  return new;
end $$;

create function rides_reopen_rejected_shift() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ids uuid[] := '{}';
begin
  -- recusa/edição do próprio admin não reabre o turno (a decisão dele vale)
  if is_admin() then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.shift_id is not null then
    ids := ids || old.shift_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.shift_id is not null then
    ids := ids || new.shift_id;
  end if;
  if exists (select 1 from shifts where id = any(ids) and review_status = 'rejected') then
    perform set_config('passos.reopen_shift', 'on', true);
    update shifts set review_status = 'pending', reject_reason = null
      where id = any(ids) and review_status = 'rejected';
    perform set_config('passos.reopen_shift', '', true);
  end if;
  return null;
end $$;

revoke execute on function rides_reopen_rejected_shift() from public, anon, authenticated;

create trigger rides_reopen_rejected_shift after insert or update or delete on rides
  for each row execute function rides_reopen_rejected_shift();

-- close_period: turno encerrado não aprovado (ex.: recusado) bloqueia o fechamento
create or replace function close_period(p_period uuid) returns int
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
