-- 0016: número do código de login reaproveitável + exclusão de motorista sem lançamentos.
-- Antes o número vinha de nextval('driver_seq') e nunca voltava (produção: PASSOS02KAIQUE porque o 01
-- foi queimado). Agora é o menor número positivo que nenhum perfil existente usa: motorista
-- desativado mantém o número; só o perfil apagado (delete_driver) o libera.

create or replace function generate_login_code(p_name text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  first_name text;
  n int;
begin
  first_name := regexp_replace(
    upper(unaccent(split_part(btrim(coalesce(p_name, '')), ' ', 1))),
    '[^A-Z]', '', 'g');
  if first_name = '' then
    raise exception 'INVALID_NAME' using errcode = 'P0001';
  end if;
  -- serializa geradores concorrentes; o create-driver ainda repete se o insert do perfil
  -- colidir no seq_number (a trava acaba com esta transação)
  perform pg_advisory_xact_lock(hashtext('passos.generate_login_code'));
  select min(g) into n
    from generate_series(1, coalesce((select max(seq_number) from profiles), 0) + 1) g
   where not exists (select 1 from profiles p where p.seq_number = g);
  return 'PASSOS' || case when n < 100 then lpad(n::text, 2, '0') else n::text end || first_name;
end $$;

-- Exclusão de motorista: só sem lançamentos (corridas, turnos, abastecimentos, ajustes, extratos,
-- quinzenas fechadas, documentos, pausas). Quinzena aberta sem nada é apagada junto (o app cria
-- quinzenas sob demanda). Desfaz o vínculo do carro e apaga o usuário de login (o perfil cai em
-- cascata), tudo numa transação. Devolve o código liberado. Só service_role (Edge Function).
create function delete_driver(p_driver_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p profiles%rowtype;
begin
  select * into p from profiles where id = p_driver_id for update;
  if not found or p.role <> 'driver' then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from rides where driver_id = p.id)
     or exists (select 1 from shifts where driver_id = p.id)
     or exists (select 1 from fuelings where driver_id = p.id)
     or exists (select 1 from adjustments where driver_id = p.id)
     or exists (select 1 from statements where driver_id = p.id)
     or exists (select 1 from driver_periods where driver_id = p.id and status = 'closed')
     or exists (select 1 from admin_documents where driver_id = p.id)
     or exists (select 1 from driver_pauses where driver_id = p.id) then
    raise exception 'HAS_ENTRIES' using errcode = 'P0001';
  end if;

  update cars set current_driver_id = null where current_driver_id = p.id;
  delete from driver_periods where driver_id = p.id;
  delete from auth.users where id = p.id; -- profiles.id references auth.users on delete cascade
  return p.login_code;
end $$;

revoke execute on function delete_driver(uuid) from public, anon, authenticated;
grant execute on function delete_driver(uuid) to service_role;
