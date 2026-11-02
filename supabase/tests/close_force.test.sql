begin;
select plan(7);

insert into periods (id, start_date, end_date, reference_fuel_price) values
  ('00000000-0000-0000-0000-000000009e01','2099-01-01','2099-01-15',6.00),
  ('00000000-0000-0000-0000-000000009e02','2026-05-01','2026-05-15',6.00);

select ok(not has_function_privilege('anon', 'close_period(uuid,boolean)', 'execute'), 'anon não executa close_period(uuid,boolean)');
select is((select count(*)::int from pg_proc where proname = 'close_period'), 1, 'só existe a assinatura nova');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select close_period('00000000-0000-0000-0000-000000009e01')$$, 'P0001', 'PERIOD_NOT_ENDED',
  'quinzena que ainda não terminou não fecha sem p_force');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000009e01', false)$$, 'P0001', 'PERIOD_NOT_ENDED',
  'p_force = false também barra');
select is(close_period('00000000-0000-0000-0000-000000009e01', true), 0, 'p_force = true fecha mesmo assim');
select is((select status from periods where id = '00000000-0000-0000-0000-000000009e01'), 'closed', 'quinzena fechada');
select is(close_period('00000000-0000-0000-0000-000000009e02'), 0, 'quinzena já terminada fecha sem p_force');

select * from finish();
rollback;
