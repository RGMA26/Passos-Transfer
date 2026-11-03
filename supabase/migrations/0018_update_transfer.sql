-- Edição do Transfer pelo admin (lista de Transfers → "Editar").
-- assigned / in_progress: cliente, data/hora (scheduled_at; ride_date é derivada no servidor pela data de
--   Brasília; ride_date enviada é ignorada), origem, destino, valor;
-- completed (aguardando conferência): só valor e endereços;
-- checked: nada (NOT_CHANGEABLE).
-- estimated_km acompanha os endereços (o app recalcula quando o endereço muda; nulo se não achar).
-- Nunca mexe em leituras, status, motorista, carro, turno ou km real (FORBIDDEN_FIELD).
-- Quinzena fechada (data antiga ou nova) → PERIOD_CLOSED pelo gatilho block_closed_period.
create function update_transfer(p_id uuid, p_fields jsonb) returns rides
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r rides%rowtype;
  v rides%rowtype;
  k text;
  v_addr constant text[] := array[
    'origin', 'origin_street', 'origin_district', 'origin_city', 'origin_state', 'origin_zip', 'origin_ref',
    'destination', 'dest_street', 'dest_district', 'dest_city', 'dest_state', 'dest_zip', 'dest_ref',
    'estimated_km', 'amount'];
  v_allowed text[];
  v_fields jsonb;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'INVALID_FIELD' using errcode = 'P0001';
  end if;

  -- ride_date nunca vem do cliente: é derivada de scheduled_at (ignorada se enviada)
  v_fields := p_fields - 'ride_date';

  select * into r from rides where id = p_id and platform = 'transfer' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  v_allowed := case r.transfer_status
    when 'assigned' then v_addr || array['client_name', 'scheduled_at']
    when 'in_progress' then v_addr || array['client_name', 'scheduled_at']
    when 'completed' then v_addr
  end;
  if v_allowed is null then
    raise exception 'NOT_CHANGEABLE' using errcode = 'P0001';
  end if;

  for k in select jsonb_object_keys(v_fields) loop
    if not (k = any (v_allowed)) then
      raise exception 'FORBIDDEN_FIELD' using errcode = 'P0001', detail = k;
    end if;
  end loop;

  v := jsonb_populate_record(r, v_fields);
  if v_fields ? 'scheduled_at' and v.scheduled_at is not null then
    v.ride_date := (v.scheduled_at at time zone 'America/Sao_Paulo')::date;
  end if;
  if btrim(coalesce(v.client_name, '')) = '' or v.amount is null or v.amount <= 0
     or v.scheduled_at is null or v.ride_date is null then
    raise exception 'INVALID_FIELD' using errcode = 'P0001';
  end if;

  update rides set
    client_name = btrim(v.client_name),
    scheduled_at = v.scheduled_at,
    ride_date = v.ride_date,
    amount = v.amount,
    estimated_km = v.estimated_km,
    origin = v.origin,
    origin_street = v.origin_street, origin_district = v.origin_district, origin_city = v.origin_city,
    origin_state = v.origin_state, origin_zip = nullif(btrim(v.origin_zip), ''),
    origin_ref = nullif(btrim(v.origin_ref), ''),
    destination = v.destination,
    dest_street = v.dest_street, dest_district = v.dest_district, dest_city = v.dest_city,
    dest_state = v.dest_state, dest_zip = nullif(btrim(v.dest_zip), ''),
    dest_ref = nullif(btrim(v.dest_ref), '')
  where id = r.id
  returning * into r;
  return r;
end $$;

revoke execute on function update_transfer(uuid, jsonb) from public, anon;
grant execute on function update_transfer(uuid, jsonb) to authenticated;
