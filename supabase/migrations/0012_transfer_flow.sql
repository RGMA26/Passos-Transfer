-- Transfer com iniciar/concluir, comprovantes obrigatórios e conferência única (spec §9.2–9.4).
--  * Status: assigned → in_progress (iniciar: odômetro + foto) → completed (concluir: odômetro + foto,
--    km = final − inicial) → checked (conferência única: aprova o Transfer e as despesas pendentes).
--    Recusa devolve para in_progress com o motivo; o motorista conclui de novo.
--  * Origem/destino em campos (rua, bairro, cidade, UF obrigatórios) e km estimado.
--  * Comprovante: corrida Uber/BlaBlaCar lançada pelo motorista exige receipt_path; despesas exigem foto.
--  * Último odômetro do carro = maior leitura entre turnos e Transfers do carro (rides.car_id).

-- ===== Colunas =====
alter table rides
  add column odometer_start int check (odometer_start >= 0),
  add column odometer_start_photo text,
  add column odometer_end int,
  add column odometer_end_photo text,
  add column started_at timestamptz,
  add column car_id uuid references cars(id),
  add column estimated_km numeric(8,1) check (estimated_km >= 0),
  add column origin_street text,
  add column origin_district text,
  add column origin_city text,
  add column origin_state text,
  add column origin_zip text,
  add column origin_ref text,
  add column dest_street text,
  add column dest_district text,
  add column dest_city text,
  add column dest_state text,
  add column dest_zip text,
  add column dest_ref text,
  add column receipt_path text,
  add constraint rides_odometer_end_check
    check (odometer_end is null or (odometer_start is not null and odometer_end >= odometer_start));

alter table rides drop constraint rides_transfer_status_check;
alter table rides add constraint rides_transfer_status_check
  check (transfer_status in ('assigned','in_progress','completed','checked'));

-- Transfers já existentes (sem dados reais): preenche o endereço antes do check (que fica VALID)
update rides
   set origin_street = coalesce(nullif(btrim(origin), ''), 'Não informado'),
       dest_street = coalesce(nullif(btrim(destination), ''), 'Não informado'),
       origin_district = 'Não informado', origin_city = 'Não informado', origin_state = 'Não informado',
       dest_district = 'Não informado', dest_city = 'Não informado', dest_state = 'Não informado'
 where platform = 'transfer';

-- Transfer exige origem e destino (rua e número, bairro, cidade, UF); CEP e referência opcionais
alter table rides add constraint rides_transfer_address_check check (
  platform <> 'transfer' or (
    btrim(coalesce(origin_street, '')) <> '' and btrim(coalesce(origin_district, '')) <> ''
    and btrim(coalesce(origin_city, '')) <> '' and btrim(coalesce(origin_state, '')) <> ''
    and btrim(coalesce(dest_street, '')) <> '' and btrim(coalesce(dest_district, '')) <> ''
    and btrim(coalesce(dest_city, '')) <> '' and btrim(coalesce(dest_state, '')) <> ''));

-- Despesa (pedágio/estacionamento) sempre com comprovante
alter table ride_expenses add constraint ride_expenses_photo_path_check
  check (btrim(photo_path) <> '');

create index rides_car_id_idx on rides (car_id) where car_id is not null;

-- ===== Último odômetro do carro (turnos + Transfers). Interno. =====
create function car_last_odometer(p_car uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select max(v) from (
    select greatest(odometer_start, coalesce(odometer_end, odometer_start)) as v
      from shifts where car_id = p_car
    union all
    select greatest(odometer_start, coalesce(odometer_end, odometer_start))
      from rides where car_id = p_car and platform = 'transfer' and odometer_start is not null
  ) x
$$;

revoke execute on function car_last_odometer(uuid) from public, anon, authenticated;

-- start_shift: igual à 0011, com o último odômetro incluindo os Transfers do carro
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

  -- serializa turnos do mesmo motorista
  select * into drv from profiles where id = uid for update;
  -- serializa inícios no mesmo carro (odômetro mínimo)
  select * into car from cars where id = p_car_id for update;
  if not found or car.ownership <> 'company' or drv.driver_type <> 'company_car' then
    raise exception 'NOT_COMPANY_CAR' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
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
          (now() at time zone 'America/Sao_Paulo')::date, p_odometer, p_photo)
  returning * into s;
  return s;
end $$;

-- ===== rides_before_write: igual à 0011, mais =====
--  * corrida Uber/BlaBlaCar lançada pelo próprio motorista exige comprovante (RECEIPT_REQUIRED);
--    o admin pode lançar/corrigir sem;
--  * Transfer em andamento reatribuído a outro motorista volta para 'assigned' sem leituras;
--  * colunas de Transfer (leituras, carro, km estimado, endereço) são anuladas em Uber/BlaBlaCar
--    (não envenenam o último odômetro do carro);
--  * em Transfer, o motorista só muda leituras/status/carro/km/turno pelas RPCs
--    (start_transfer/complete_transfer ligam a flag de sessão passos.transfer_rpc) → FORBIDDEN_FIELD.
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
  else
    -- snapshot imutável: ninguém edita por corrida
    new.driver_pct := old.driver_pct;
  end if;

  if new.platform <> 'transfer' then
    new.odometer_start := null;
    new.odometer_start_photo := null;
    new.odometer_end := null;
    new.odometer_end_photo := null;
    new.started_at := null;
    new.car_id := null;
    new.estimated_km := null;
    new.origin_street := null; new.origin_district := null; new.origin_city := null;
    new.origin_state := null; new.origin_zip := null; new.origin_ref := null;
    new.dest_street := null; new.dest_district := null; new.dest_city := null;
    new.dest_state := null; new.dest_zip := null; new.dest_ref := null;
  elsif auth.uid() is not null and auth.uid() = new.driver_id and not is_admin()
        and coalesce(current_setting('passos.transfer_rpc', true), '') <> 'on'
        and tg_op = 'UPDATE' and old.platform = 'transfer'
        and ((new.transfer_status, new.odometer_start, new.odometer_start_photo, new.odometer_end,
                 new.odometer_end_photo, new.started_at, new.car_id, new.km, new.shift_id)
                is distinct from
                (old.transfer_status, old.odometer_start, old.odometer_start_photo, old.odometer_end,
                 old.odometer_end_photo, old.started_at, old.car_id, old.km, old.shift_id)) then
    raise exception 'FORBIDDEN_FIELD' using errcode = 'P0001';
  end if;

  if new.platform in ('uber', 'blablacar') then
    if drv.driver_type = 'own_car' then
      raise exception 'PLATFORM_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if auth.uid() is not null and auth.uid() = new.driver_id and not is_admin()
       and btrim(coalesce(new.receipt_path, '')) = ''
       and (tg_op = 'INSERT' or new.receipt_path is distinct from old.receipt_path) then
      raise exception 'RECEIPT_REQUIRED' using errcode = 'P0001';
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
    if new.transfer_status = 'in_progress' then
      -- o novo motorista inicia do zero
      new.transfer_status := 'assigned';
      new.odometer_start := null;
      new.odometer_start_photo := null;
      new.odometer_end := null;
      new.odometer_end_photo := null;
      new.started_at := null;
      new.car_id := null;
      new.km := null;
    end if;
  end if;

  return new;
end $$;

-- ===== Iniciar Transfer (motorista dono) =====
create function start_transfer(p_ride_id uuid, p_odometer int, p_photo text)
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
  if r.transfer_status <> 'assigned' then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;
  if p_odometer is null or p_odometer < 0 then
    raise exception 'INVALID_ODOMETER' using errcode = 'P0001';
  end if;

  select * into drv from profiles where id = uid;
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
         odometer_start_photo = p_photo, started_at = now(), car_id = v_car,
         shift_id = v_shift.id, odometer_end = null, odometer_end_photo = null, km = null
   where id = r.id
   returning * into r;
  perform set_config('passos.transfer_rpc', '', true);
  return r;
end $$;

-- ===== Concluir Transfer (motorista dono); substitui complete_transfer(uuid, numeric) =====
drop function if exists complete_transfer(uuid, numeric);

create function complete_transfer(p_ride_id uuid, p_odometer int, p_photo text)
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
  if r.transfer_status <> 'in_progress' then
    raise exception 'NOT_STARTED' using errcode = 'P0001';
  end if;
  if p_odometer is null or p_odometer < r.odometer_start then
    raise exception 'ODOMETER_BELOW_START' using errcode = 'P0001';
  end if;
  if p_photo is null or btrim(p_photo) = '' then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;

  perform set_config('passos.transfer_rpc', 'on', true);
  update rides
     set transfer_status = 'completed', odometer_end = p_odometer, odometer_end_photo = p_photo,
         km = p_odometer - r.odometer_start, reject_reason = null
   where id = r.id
   returning * into r;
  perform set_config('passos.transfer_rpc', '', true);
  return r;
end $$;

-- ===== end_shift: igual à 0011, mas não encerra com Transfer do turno em andamento =====
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

-- ===== Conferência =====
-- transfer: aprovar → checked + despesas pendentes aprovadas (mesma transação);
--           recusar → in_progress com o motivo, despesas seguem pendentes.
-- expense: só pela conferência do Transfer (USE_TRANSFER_REVIEW).
-- p_expense_ids (opcional): ao aprovar um Transfer, os pedágios/estacionamentos que o admin viu.
-- Se houver despesa pendente fora da lista → NEW_EXPENSES (a tela recarrega). Nulo = aprova todas.
drop function review_item(text, uuid, boolean, text);
create function review_item(p_kind text, p_id uuid, p_approved boolean, p_reason text,
                            p_expense_ids uuid[] default null)
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
  if p_kind = 'expense' then
    raise exception 'USE_TRANSFER_REVIEW' using errcode = 'P0001';
  end if;
  if not v_approved and v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_kind = 'fueling' then
    update fuelings set review_status = v_status, reject_reason = v_reason where id = p_id;
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
      if v_approved and p_expense_ids is not null and exists (
           select 1 from ride_expenses e
            where e.ride_id = p_id and e.review_status = 'pending'
              and not (e.id = any (p_expense_ids))) then
        raise exception 'NEW_EXPENSES' using errcode = 'P0001';
      end if;
      update rides
        set transfer_status = case when v_approved then 'checked' else 'in_progress' end,
            reject_reason = v_reason
        where id = p_id;
      if v_approved then
        update ride_expenses set review_status = 'approved', reject_reason = null
          where ride_id = p_id and review_status = 'pending';
      end if;
    end if;
  end if;

  if not v_found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

revoke execute on function review_item(text, uuid, boolean, text, uuid[]) from public, anon;
grant execute on function review_item(text, uuid, boolean, text, uuid[]) to authenticated;

-- ===== RLS de despesas: Transfer atribuído, em andamento ou concluído =====
drop policy driver_insert on ride_expenses;
drop policy driver_update on ride_expenses;
create policy driver_insert on ride_expenses for insert to authenticated
  with check (
    is_active_driver()
    and review_status = 'pending' and reject_reason is null
    and exists (
      select 1 from rides r
      where r.id = ride_id and r.driver_id = auth.uid()
        and r.platform = 'transfer'
        and r.transfer_status in ('assigned','in_progress','completed'))
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
        and r.transfer_status in ('assigned','in_progress','completed'))
  );

revoke execute on function start_transfer(uuid, int, text) from public, anon;
revoke execute on function complete_transfer(uuid, int, text) from public, anon;
grant execute on function start_transfer(uuid, int, text) to authenticated;
grant execute on function complete_transfer(uuid, int, text) to authenticated;
