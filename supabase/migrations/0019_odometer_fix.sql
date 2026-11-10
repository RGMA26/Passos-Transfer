-- 0019: correção de odômetro e leitura fora do normal.
-- Em produção um Transfer foi lançado com 1.010.000 → 10.102.500 (km 9.092.500) dentro de um turno
-- 57.876 → 57.877, foi conferido, entrou no extrato e travou o carro (ODOMETER_BELOW_LAST no próximo
-- início). Ninguém foi avisado e o admin não tinha como corrigir. Agora:
--  * unreview_item: o admin desfaz a conferência (o item volta para a fila);
--  * admin_fix_transfer_odometer / admin_fix_shift_odometer: o admin corrige as leituras (Transfer não
--    conferido; em quinzena fechada também o conferido, mexendo só nas leituras — o extrato congelado fica);
--  * odometer_suspect (turno e Transfer): leitura fora do normal vira pendência 🟠 (não bloqueia), inclusive
--    o turno que termina abaixo da leitura de um Transfer dele;
--  * teto: leitura acima de 9.999.999 é recusada (INVALID_ODOMETER) em qualquer caminho.

-- ===== Desfazer conferência =====
-- transfer: checked → completed (despesas aprovadas voltam a pendentes, as recusadas ficam);
-- shift: approved|rejected → pending; fueling/expense: approved|rejected → pending.
-- Motivo da recusa é limpo. Item não conferido → NOT_REVIEWED. Quinzena fechada → PERIOD_CLOSED
-- (gatilho block_closed_period). Despesa de Transfer conferido: desfazer o Transfer (USE_TRANSFER_REVIEW).
create function unreview_item(p_kind text, p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text;
  v_parent text;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('fueling', 'expense', 'shift', 'transfer') then
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;

  if p_kind = 'transfer' then
    select transfer_status into v_status from rides
     where id = p_id and platform = 'transfer' for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status <> 'checked' then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    update rides set transfer_status = 'completed', reject_reason = null where id = p_id;
    update ride_expenses set review_status = 'pending', reject_reason = null
     where ride_id = p_id and review_status = 'approved';
  elsif p_kind = 'shift' then
    select review_status into v_status from shifts where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    update shifts set review_status = 'pending', reject_reason = null where id = p_id;
  elsif p_kind = 'fueling' then
    select review_status into v_status from fuelings where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    update fuelings set review_status = 'pending', reject_reason = null where id = p_id;
  else
    select e.review_status, r.transfer_status into v_status, v_parent
      from ride_expenses e join rides r on r.id = e.ride_id
     where e.id = p_id
       for update of e;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'NOT_REVIEWED' using errcode = 'P0001';
    end if;
    if v_parent = 'checked' then
      raise exception 'USE_TRANSFER_REVIEW' using errcode = 'P0001';
    end if;
    update ride_expenses set review_status = 'pending', reject_reason = null where id = p_id;
  end if;
end $$;

revoke execute on function unreview_item(text, uuid) from public, anon;
grant execute on function unreview_item(text, uuid) to authenticated;

-- ===== Teto e leitura fora do normal =====
-- Teto: leitura > 9.999.999 → INVALID_ODOMETER (gatilhos abaixo: vale para start_shift, end_shift,
-- start_transfer, complete_transfer, correções do admin e qualquer escrita direta).
-- Suspeita (não bloqueia; marca o turno/Transfer e gera pendência 🟠 enquanto não foi conferido):
-- (a) leitura inicial mais de 1.000 km acima da última leitura do carro (sem contar a própria linha);
-- (b) Transfer com mais de 1.000 km; (c) turno com mais de 1.500 km;
-- (d) turno que terminou abaixo da maior leitura de um Transfer dele.
-- Recalculada quando as leituras/carro mudam ou quando alguém escreve na marca (nunca vem do cliente).
alter table shifts add column odometer_suspect boolean not null default false;
alter table rides add column odometer_suspect boolean not null default false;

-- Maior leitura do carro sem contar o turno/Transfer informado. Interno.
create function car_prev_odometer(p_car uuid, p_shift uuid, p_ride uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select max(v) from (
    select greatest(odometer_start, coalesce(odometer_end, odometer_start)) as v
      from shifts where car_id = p_car and id is distinct from p_shift
    union all
    select greatest(odometer_start, coalesce(odometer_end, odometer_start))
      from rides where car_id = p_car and platform = 'transfer' and odometer_start is not null
       and id is distinct from p_ride
  ) x
$$;

-- Maior leitura dos Transfers de um turno. Interno.
create function shift_transfer_max(p_shift uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select max(greatest(odometer_start, coalesce(odometer_end, odometer_start)))
    from rides where shift_id = p_shift and platform = 'transfer' and odometer_start is not null
$$;

revoke execute on function car_prev_odometer(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function shift_transfer_max(uuid) from public, anon, authenticated;

create function shifts_odometer_suspect() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev int;
  v_tr int;
  v_changed boolean := tg_op = 'INSERT'
    or (new.odometer_start, new.odometer_end, new.car_id) is distinct from (old.odometer_start, old.odometer_end, old.car_id);
begin
  if not v_changed and new.odometer_suspect is not distinct from old.odometer_suspect then
    return new;
  end if;
  if v_changed and (new.odometer_start > 9999999 or new.odometer_end > 9999999) then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;
  v_prev := car_prev_odometer(new.car_id, new.id, null);
  v_tr := shift_transfer_max(new.id);
  new.odometer_suspect :=
    coalesce(new.odometer_start > v_prev + 1000, false)
    or coalesce(new.odometer_end - new.odometer_start > 1500, false)
    or coalesce(new.odometer_end < v_tr, false);
  return new;
end $$;

create function rides_odometer_suspect() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev int;
  v_changed boolean := tg_op = 'INSERT'
    or (new.odometer_start, new.odometer_end, new.car_id, new.platform)
       is distinct from (old.odometer_start, old.odometer_end, old.car_id, old.platform);
begin
  if new.platform <> 'transfer' or new.odometer_start is null then
    new.odometer_suspect := false;
    return new;
  end if;
  if not v_changed and new.odometer_suspect is not distinct from old.odometer_suspect then
    return new;
  end if;
  if v_changed and (new.odometer_start > 9999999 or new.odometer_end > 9999999) then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;
  v_prev := case when new.car_id is null then null else car_prev_odometer(new.car_id, null, new.id) end;
  new.odometer_suspect :=
    coalesce(new.odometer_start > v_prev + 1000, false)
    or coalesce(new.odometer_end - new.odometer_start > 1000, false);
  return new;
end $$;

revoke execute on function shifts_odometer_suspect() from public, anon, authenticated;
revoke execute on function rides_odometer_suspect() from public, anon, authenticated;

-- "rides_o…" roda depois de rides_before_write (que limpa as leituras fora de Transfer)
create trigger rides_odometer_suspect before insert or update on rides
  for each row execute function rides_odometer_suspect();
create trigger shifts_odometer_suspect before insert or update on shifts
  for each row execute function shifts_odometer_suspect();

-- Sem backfill: a base de produção foi zerada antes desta migração (só o admin existe).

-- ===== Quinzena fechada: saída de emergência para o odômetro =====
-- block_closed_period: igual à 0010, mas deixa passar a UPDATE do admin feita pelas RPCs de correção
-- (flag de sessão passos.admin_odometer_fix) quando só mudam leituras, km e a marca de suspeita.
-- O extrato congelado (statements) não é recalculado.
create or replace function block_closed_period() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_driver uuid;
  d date;
  v_last date;
  v_odo constant text[] := array['odometer_start', 'odometer_end', 'km', 'odometer_suspect'];
begin
  if tg_op in ('INSERT', 'UPDATE') and tg_table_name <> 'adjustments' then
    select x.driver, x.d into v_driver, d from row_driver_date(tg_table_name, to_jsonb(new)) x;
    if v_driver is not null and v_driver = auth.uid()
       and exists (select 1 from profiles where id = v_driver and paused) then
      select max(end_date) into v_last from driver_periods where driver_id = v_driver;
      if v_last is null or d > v_last then
        raise exception 'DRIVER_PAUSED' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name in ('rides', 'shifts')
     and coalesce(current_setting('passos.admin_odometer_fix', true), '') = 'on' and is_admin()
     and (to_jsonb(new) - v_odo) = (to_jsonb(old) - v_odo) then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and row_in_closed_period(tg_table_name, to_jsonb(old)) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and row_in_closed_period(tg_table_name, to_jsonb(new)) then
    raise exception 'PERIOD_CLOSED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke execute on function block_closed_period() from public, anon, authenticated;

-- ===== Corrigir odômetro do Transfer (admin) =====
-- in_progress: só a leitura inicial (p_end nulo); completed: as duas, km = final − inicial.
-- checked: só em quinzena fechada (lá não dá para desfazer a conferência); fora dela → NOT_CHANGEABLE.
-- assigned → NOT_CHANGEABLE. Leitura nula/negativa/> 9.999.999 → INVALID_ODOMETER.
-- Em quinzena fechada só leituras, km e a marca mudam (block_closed_period + flag); o extrato fica.
-- A marca do turno do Transfer é recalculada (regra d). Auditoria: gatilhos audit_*.
create function admin_fix_transfer_odometer(p_id uuid, p_start int, p_end int)
returns rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r rides%rowtype;
  v_closed boolean;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into r from rides where id = p_id and platform = 'transfer' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_closed := row_in_closed_period('rides', to_jsonb(r));
  if not (r.transfer_status in ('in_progress', 'completed') or (v_closed and r.transfer_status = 'checked')) then
    raise exception 'NOT_CHANGEABLE' using errcode = 'P0001';
  end if;
  if p_start is null or p_start < 0 or p_start > 9999999 or p_end > 9999999
     or (r.transfer_status in ('completed', 'checked') and p_end is null)
     or (r.transfer_status = 'in_progress' and p_end is not null) then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;
  if p_end is not null and p_end < p_start then
    raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
  end if;

  perform set_config('passos.admin_odometer_fix', 'on', true);
  update rides
     set odometer_start = p_start,
         odometer_end = p_end,
         km = case when p_end is null then null else p_end - p_start end
   where id = r.id
   returning * into r;
  if r.shift_id is not null then
    -- escrever na marca força o recálculo (regra d: final do turno × leituras dos Transfers)
    update shifts set odometer_suspect = not odometer_suspect where id = r.shift_id;
  end if;
  perform set_config('passos.admin_odometer_fix', '', true);
  return r;
end $$;

revoke execute on function admin_fix_transfer_odometer(uuid, int, int) from public, anon;
grant execute on function admin_fix_transfer_odometer(uuid, int, int) to authenticated;

-- ===== Corrigir odômetro do turno (admin) =====
-- Substitui a UPDATE direta do app. Turno aberto: só a inicial (p_end nulo); encerrado: as duas.
-- Leitura nula/negativa/> 9.999.999 → INVALID_ODOMETER; final < inicial → ODOMETER_BELOW_START.
-- Vale também em quinzena fechada (só as leituras mudam; o extrato congelado fica).
create function admin_fix_shift_odometer(p_id uuid, p_start int, p_end int)
returns shifts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s shifts%rowtype;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into s from shifts where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_start is null or p_start < 0 or p_start > 9999999 or p_end > 9999999
     or (s.ended_at is null and p_end is not null)
     or (s.ended_at is not null and p_end is null) then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;
  if p_end is not null and p_end < p_start then
    raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
  end if;

  perform set_config('passos.admin_odometer_fix', 'on', true);
  update shifts set odometer_start = p_start, odometer_end = p_end where id = s.id returning * into s;
  perform set_config('passos.admin_odometer_fix', '', true);
  return s;
end $$;

revoke execute on function admin_fix_shift_odometer(uuid, int, int) from public, anon;
grant execute on function admin_fix_shift_odometer(uuid, int, int) to authenticated;

-- ===== Central de pendências: igual à 0015, + 🟠 leitura fora do normal (turno/Transfer não conferidos) =====
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

  -- 🟠 leitura fora do normal (odometer_suspect) ainda não conferida, fora de quinzena fechada.
  -- Transfer em andamento: item_type 'transfer_in_progress' (o app leva para a lista de Transfers).
  return query
  select 'orange'::text, x.item_type, x.id, x.driver_id, pr.name, x.lbl, x.d
    from (
      select 'shift'::text as item_type, s.id, s.driver_id, s.start_date as d,
             case when s.odometer_end < shift_transfer_max(s.id)
                  then 'Odômetro do turno menor que o de um Transfer'
                  else 'Odômetro fora do normal' end::text as lbl
        from shifts s
       where s.odometer_suspect and s.ended_at is not null and s.review_status in ('pending', 'rejected')
      union all
      select case when r.transfer_status = 'in_progress' then 'transfer_in_progress' else 'transfer' end,
             r.id, r.driver_id, r.ride_date, 'Odômetro fora do normal'
        from rides r
       where r.platform = 'transfer' and r.odometer_suspect and r.transfer_status in ('in_progress', 'completed')
    ) x
    join profiles pr on pr.id = x.driver_id
   where not exists (select 1 from driver_periods p
                      where p.driver_id = x.driver_id and p.status = 'closed'
                        and x.d between p.start_date and p.end_date)
   order by x.d;
end $$;
