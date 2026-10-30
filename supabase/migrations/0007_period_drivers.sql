-- Lista (para o admin) os motoristas com movimento na quinzena: mesmo conjunto que close_period congela.
create function period_drivers(p_period uuid) returns setof uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN'; end if;
  return query select period_movement_drivers(p_period);
end $$;

revoke execute on function period_drivers(uuid) from public, anon;
grant execute on function period_drivers(uuid) to authenticated;
