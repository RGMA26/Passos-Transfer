begin;
select plan(23);
-- isola dos dados do seed.sql (revertido no rollback)
update cars set current_driver_id = null;
update profiles set current_car_id = null;
delete from profiles;
delete from cars;
delete from auth.users;

select has_table('public', t, t || ' existe')
from unnest(array['profiles','cars','periods','shifts','rides','ride_expenses','fuelings','adjustments','statements','audit_log']) as t;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct)
    values ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'D1','own_car',0)$$,
  '23514', null, 'pct 0 rejeitado');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct)
    values ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'D1','own_car',101)$$,
  '23514', null, 'pct 101 rejeitado');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct)
    values ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'D1','company_car',50)$$,
  '23514', null, 'company_car sem uber_pct rejeitado');

select lives_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, uber_pct)
    values ('00000000-0000-0000-0000-0000000000a2','driver','d2',2,'D2','company_car',50,25.5)$$,
  'motorista valido aceito');

insert into cars (id, model, plate, consumption_km_l, ownership)
values ('00000000-0000-0000-0000-0000000000c1','Onix','AAA0A00',12.5,'own');

select throws_ok(
  $$insert into shifts (driver_id, car_id, consumption_km_l, started_at, start_date, odometer_start, odometer_end)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1',12.5, now(), current_date, 1000, 900)$$,
  '23514', null, 'odometro final < inicial rejeitado');

insert into periods (id, start_date, end_date)
values ('00000000-0000-0000-0000-0000000000b1','2026-10-01','2026-10-15');

select throws_ok(
  $$insert into adjustments (driver_id, period_id, kind, amount, description)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','advance',100,'vale')$$,
  '23514', null, 'advance positivo rejeitado');

select lives_ok(
  $$insert into adjustments (driver_id, period_id, kind, amount, description)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','advance',-100,'vale')$$,
  'advance negativo aceito');

select throws_ok(
  $$insert into periods (start_date, end_date) values ('2026-09-01','2026-09-20')$$,
  '23514', null, 'end_date invalido rejeitado');

select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000a2','transfer','2026-10-02',100)$$,
  '23514', null, 'transfer sem client_name rejeitado');

select is(period_for_date('2026-11-16'), period_for_date('2026-11-16'), 'period_for_date idempotente');

select results_eq(
  $$select start_date, end_date from periods where id = period_for_date('2026-11-16')$$,
  $$values ('2026-11-16'::date, '2026-11-30'::date)$$,
  'quinzena de 2026-11-16 vai ate 30');

-- cria a quinzena em statement separado (o snapshot da query externa nao veria o insert)
select lives_ok($$select period_for_date('2026-02-10')$$, 'cria quinzena de fevereiro');

select results_eq(
  $$select end_date from periods where start_date = '2026-02-01'$$,
  $$values ('2026-02-15'::date)$$,
  'primeira quinzena termina dia 15');

select * from finish();
rollback;
