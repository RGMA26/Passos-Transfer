-- 0019: correção de odômetro e leitura fora do normal.
-- Em produção um Transfer foi lançado com 1.010.000 → 10.102.500 (km 9.092.500) dentro de um turno
-- 57.876 → 57.877, foi conferido, entrou no extrato e travou o carro (ODOMETER_BELOW_LAST no próximo
-- início). Ninguém foi avisado e o admin não tinha como corrigir. Agora:
--  * unreview_item: o admin desfaz a conferência (o item volta para a fila);
--  * admin_fix_transfer_odometer: o admin corrige as leituras de um Transfer não conferido;
--  * odometer_suspect (turno e Transfer): leitura fora do normal vira pendência 🟠 (não bloqueia);
--  * end_shift: a leitura final não pode ficar abaixo das leituras dos Transfers do turno.

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

-- ===== Corrigir odômetro do Transfer (admin) =====
-- in_progress: só a leitura inicial (p_end nulo); completed: as duas, km = final − inicial.
-- checked → NOT_CHANGEABLE (desfazer a conferência antes); assigned → NOT_CHANGEABLE.
-- Quinzena fechada → PERIOD_CLOSED (gatilho block_closed_period). Auditoria: gatilho audit_rides.
create function admin_fix_transfer_odometer(p_id uuid, p_start int, p_end int)
returns rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r rides%rowtype;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into r from rides where id = p_id and platform = 'transfer' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.transfer_status not in ('in_progress', 'completed') then
    raise exception 'NOT_CHANGEABLE' using errcode = 'P0001';
  end if;
  if p_start is null or p_start < 0
     or (r.transfer_status = 'completed' and p_end is null)
     or (r.transfer_status = 'in_progress' and p_end is not null) then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;
  if p_end is not null and p_end < p_start then
    raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
  end if;

  update rides
     set odometer_start = p_start,
         odometer_end = p_end,
         km = case when p_end is null then null else p_end - p_start end
   where id = r.id
   returning * into r;
  return r;
end $$;

revoke execute on function admin_fix_transfer_odometer(uuid, int, int) from public, anon;
grant execute on function admin_fix_transfer_odometer(uuid, int, int) to authenticated;

-- ===== Leitura fora do normal =====
-- Não bloqueia: marca o turno/Transfer (odometer_suspect) e gera pendência 🟠 para o admin conferir.
-- (a) leitura inicial mais de 1.000 km acima da última leitura do carro (sem contar a própria linha);
-- (b) Transfer com mais de 1.000 km; (c) turno com mais de 1.500 km.
-- Recalculada quando as leituras (ou o carro) mudam; nunca vem do cliente.
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

revoke execute on function car_prev_odometer(uuid, uuid, uuid) from public, anon, authenticated;

create function shifts_odometer_suspect() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev int;
begin
  if tg_op = 'UPDATE'
     and (new.odometer_start, new.odometer_end, new.car_id)
         is not distinct from (old.odometer_start, old.odometer_end, old.car_id) then
    new.odometer_suspect := old.odometer_suspect;
    return new;
  end if;
  v_prev := car_prev_odometer(new.car_id, new.id, null);
  new.odometer_suspect :=
    coalesce(new.odometer_start > v_prev + 1000, false)
    or coalesce(new.odometer_end - new.odometer_start > 1500, false);
  return new;
end $$;

create function rides_odometer_suspect() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev int;
begin
  if new.platform <> 'transfer' or new.odometer_start is null then
    new.odometer_suspect := false;
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.odometer_start, new.odometer_end, new.car_id, new.platform)
         is not distinct from (old.odometer_start, old.odometer_end, old.car_id, old.platform) then
    new.odometer_suspect := old.odometer_suspect;
    return new;
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

-- ===== end_shift: igual à 0015, + a leitura final ≥ maior leitura dos Transfers do turno =====
-- (senão ODOMETER_BELOW_LAST, detail = a maior leitura; o km do turno não pode ficar menor que o dos Transfers)
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
  v_transfers int;
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
    -- a leitura final não fica abaixo das leituras dos Transfers do turno
    select max(greatest(odometer_start, coalesce(odometer_end, odometer_start))) into v_transfers
      from rides where shift_id = s.id and platform = 'transfer' and odometer_start is not null;
    if v_transfers is not null and p_odometer < v_transfers then
      raise exception 'ODOMETER_BELOW_LAST' using errcode = 'P0001', detail = v_transfers::text;
    end if;
    update shifts
      set ended_at = now(), odometer_end = p_odometer, odometer_end_photo = nullif(btrim(p_photo), ''),
          uber_earnings_photo = nullif(btrim(p_uber_photo), '')
      where id = s.id
      returning * into s;
  elsif (s.odometer_end_photo is null and nullif(btrim(p_photo), '') is not null)
     or (s.uber_earnings_photo is null and nullif(btrim(p_uber_photo), '') is not null) then
    -- repetição (offline): só preenche as fotos que ainda estão vazias
    begin
      update shifts
         set odometer_end_photo = coalesce(odometer_end_photo, nullif(btrim(p_photo), '')),
             uber_earnings_photo = coalesce(uber_earnings_photo, nullif(btrim(p_uber_photo), ''))
       where id = s.id
       returning * into s;
    exception when raise_exception then
      null; -- ex.: quinzena fechada: a repetição continua devolvendo o resultado
    end;
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

-- ===== Central de pendências: igual à 0015, + 🟠 "Odômetro fora do normal" (turno/Transfer) =====
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

  -- 🟠 leitura fora do normal (odometer_suspect), fora de quinzena fechada
  return query
  select 'orange'::text, x.item_type, x.id, x.driver_id, pr.name, 'Odômetro fora do normal'::text, x.d
    from (
      select 'shift'::text as item_type, s.id, s.driver_id, s.start_date as d
        from shifts s where s.odometer_suspect
      union all
      select 'transfer', r.id, r.driver_id, r.ride_date
        from rides r where r.platform = 'transfer' and r.odometer_suspect
    ) x
    join profiles pr on pr.id = x.driver_id
   where not exists (select 1 from driver_periods p
                      where p.driver_id = x.driver_id and p.status = 'closed'
                        and x.d between p.start_date and p.end_date)
   order by x.d;
end $$;
