begin;
select plan(9);

-- Fixtures próprias (uuids 9xx). Admin do seed: ad01.
-- F1 (9d01): ciclo em 2099 (quinzena que ainda não terminou) | F2 (9d02): ciclo em 05/2026 (já terminada)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000009d01'), ('00000000-0000-0000-0000-000000009d02');
insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-000000009c01','HB20','CLF0A01','flex',12.5,'own');
insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, current_car_id, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000009d01','driver','clf-01',9901,'F1','own_car',30,'00000000-0000-0000-0000-000000009c01','50000000132','2099-01-01'),
  ('00000000-0000-0000-0000-000000009d02','driver','clf-02',9902,'F2','own_car',30,'00000000-0000-0000-0000-000000009c01','50000000213','2026-05-01');

create temp table pf as
  select driver_period_for('00000000-0000-0000-0000-000000009d01', '2099-01-05') as f1,
         driver_period_for('00000000-0000-0000-0000-000000009d02', '2026-05-05') as f2;
grant select on pf to authenticated;

select ok(not has_function_privilege('anon', 'close_driver_period(uuid,boolean,boolean)', 'execute'), 'anon não executa close_driver_period');
select is((select count(*)::int from pg_proc where proname = 'close_driver_period'), 1, 'só existe uma assinatura');
select is((select count(*)::int from pg_proc where proname = 'close_period'), 0, 'close_period global removido');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select close_driver_period((select f1 from pf))$$, 'P0001', 'PERIOD_NOT_ENDED',
  'quinzena que ainda não terminou não fecha sem p_force');
select throws_ok($$select close_driver_period((select f1 from pf), false)$$, 'P0001', 'PERIOD_NOT_ENDED',
  'p_force = false também barra');
select ok(close_driver_period((select f1 from pf), true) is not null, 'p_force = true fecha mesmo assim');
select is((select status from driver_periods where id = (select f1 from pf)), 'closed', 'quinzena fechada');
select ok(close_driver_period((select f2 from pf)) is not null, 'quinzena já terminada fecha sem p_force');
select is((select count(*)::int from statements where driver_period_id in ((select f1 from pf), (select f2 from pf))), 2,
  'um extrato por quinzena fechada');

select * from finish();
rollback;
