-- Combustíveis do carro como conjunto (cars.fuels). Ex.: flex com kit GNV = {gasolina, alcool, gnv}.
-- fuel_type fica como legado: opcional, mantido como rótulo derivado (flex/hibrido/um combustível)
-- ou nulo quando a combinação não tem rótulo antigo. Clientes antigos que só mandam fuel_type
-- continuam funcionando: fuels é derivado dele.

-- Mapa do tipo antigo para o conjunto (backfill e clientes antigos)
create function fuels_for_type(p_type text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_type
           when 'flex' then array['gasolina','alcool']
           when 'hibrido' then array['gasolina','eletrico']
           when 'gasolina' then array['gasolina']
           when 'alcool' then array['alcool']
           when 'diesel' then array['diesel']
           when 'gnv' then array['gnv']
           when 'eletrico' then array['eletrico']
         end
$$;

-- Ordem fixa (gasolina, alcool, diesel, gnv, eletrico), sem repetidos; valores desconhecidos
-- ficam no fim para o check recusar.
create function normalize_fuels(p_fuels text[]) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case when p_fuels is null then null else coalesce((
    select array_agg(f order by coalesce(array_position(array['gasolina','alcool','diesel','gnv','eletrico'], f), 99), f)
      from (select distinct unnest(p_fuels) as f) d), '{}') end
$$;

-- Rótulo antigo de um conjunto, quando existe
create function fuel_type_label(p_fuels text[]) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
           when p_fuels = array['gasolina','alcool'] then 'flex'
           when p_fuels = array['gasolina','eletrico'] then 'hibrido'
           when cardinality(p_fuels) = 1 then p_fuels[1]
         end
$$;

alter table cars add column fuels text[];
update cars set fuels = fuels_for_type(fuel_type);
alter table cars
  alter column fuels set not null,
  alter column fuel_type drop not null,
  add constraint cars_fuels_check check (
    cardinality(fuels) > 0
    and fuels <@ array['gasolina','alcool','diesel','gnv','eletrico']::text[]);

create function cars_fuels_sync() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.fuels is null then
      new.fuels := fuels_for_type(new.fuel_type);
    else
      new.fuels := normalize_fuels(new.fuels);
      new.fuel_type := fuel_type_label(new.fuels);
    end if;
  elsif new.fuels is distinct from old.fuels then
    new.fuels := normalize_fuels(new.fuels);
    new.fuel_type := fuel_type_label(new.fuels);
  elsif new.fuel_type is distinct from old.fuel_type and new.fuel_type is not null then
    new.fuels := fuels_for_type(new.fuel_type);
  end if;
  return new;
end $$;

revoke execute on function cars_fuels_sync() from public, anon, authenticated;

create trigger cars_fuels_sync before insert or update on cars
  for each row execute function cars_fuels_sync();

-- Abastecimento: o combustível precisa estar entre os do carro
create or replace function fuelings_fuel() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fuels text[];
begin
  -- compatibilidade só quando o combustível/carro é informado (a conferência não esbarra
  -- numa troca posterior dos combustíveis do carro); km_equivalent usa o consumo atual a cada escrita
  select fuels into v_fuels from cars where id = new.car_id;
  -- o motorista só lança abastecimento do carro atual dele (admin não é barrado)
  if (tg_op = 'INSERT' or new.car_id is distinct from old.car_id)
     and auth.uid() is not null and auth.uid() = new.driver_id and not is_admin()
     and new.car_id is distinct from (select current_car_id from profiles where id = new.driver_id) then
    raise exception 'FUEL_CAR_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if (tg_op = 'INSERT' or new.fuel is distinct from old.fuel or new.car_id is distinct from old.car_id)
     and (v_fuels is null or not (new.fuel = any (v_fuels))) then
    raise exception 'FUEL_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  new.values_conflict :=
    abs(new.quantity * new.unit_price - new.amount) > greatest(0.10, 0.005 * new.amount);
  new.km_equivalent := round(new.quantity * car_consumption(new.car_id, new.fuel), 3);
  return new;
end $$;
