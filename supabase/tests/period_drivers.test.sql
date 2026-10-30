begin;
select plan(5);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000801'), ('00000000-0000-0000-0000-000000000802');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, active) values
  ('00000000-0000-0000-0000-000000000801','driver','pd-01',9801,'P1','own_car',null,30,true),
  ('00000000-0000-0000-0000-000000000802','driver','pd-02',9802,'P2','own_car',null,30,false);
insert into periods (id, start_date, end_date) values ('00000000-0000-0000-0000-000000008e01','2026-11-01','2026-11-15');
insert into adjustments (id, driver_id, period_id, kind, amount, description) values
  ('00000000-0000-0000-0000-000000008a01','00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000008e01','bonus',10,'x'),
  ('00000000-0000-0000-0000-000000008a02','00000000-0000-0000-0000-000000000802','00000000-0000-0000-0000-000000008e01','bonus',10,'y');

select ok(not has_function_privilege('anon', 'period_drivers(uuid)', 'execute'), 'anon não executa period_drivers');
select ok(has_function_privilege('authenticated', 'period_drivers(uuid)', 'execute'), 'authenticated executa period_drivers');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000801","role":"authenticated"}';
select throws_ok($$select * from period_drivers('00000000-0000-0000-0000-000000008e01')$$, 'P0001', 'FORBIDDEN', 'motorista recebe FORBIDDEN');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select results_eq(
  $$select * from period_drivers('00000000-0000-0000-0000-000000008e01') order by 1$$,
  $$values ('00000000-0000-0000-0000-000000000801'::uuid), ('00000000-0000-0000-0000-000000000802'::uuid)$$,
  'admin recebe os motoristas com movimento (inclusive inativos)');
reset role;
select results_eq(
  $$select * from period_movement_drivers('00000000-0000-0000-0000-000000008e01') order by 1$$,
  $$values ('00000000-0000-0000-0000-000000000801'::uuid), ('00000000-0000-0000-0000-000000000802'::uuid)$$,
  'é o mesmo conjunto de period_movement_drivers (usado por close_period)');

select * from finish();
rollback;
