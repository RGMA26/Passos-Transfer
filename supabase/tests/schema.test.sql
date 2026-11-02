begin;
select plan(23);
-- isola dos dados do seed.sql (revertido no rollback)
update cars set current_driver_id = null;
update profiles set current_car_id = null;
delete from profiles;
delete from cars;
delete from auth.users;

select has_table('public', t, t || ' existe')
from unnest(array['profiles','cars','driver_periods','shifts','rides','ride_expenses','fuelings','adjustments','statements','audit_log']) as t;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, cpf)
    values ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'D1','own_car',0,'10000000795')$$,
  '23514', null, 'pct 0 rejeitado');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, cpf)
    values ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'D1','own_car',101,'10000000795')$$,
  '23514', null, 'pct 101 rejeitado');

select throws_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, cpf)
    values ('00000000-0000-0000-0000-0000000000a1','driver','d1',1,'D1','company_car',50,'10000000795')$$,
  '23514', null, 'company_car sem uber_pct rejeitado');

select lives_ok(
  $$insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, uber_pct, cpf, cycle_start_date)
    values ('00000000-0000-0000-0000-0000000000a2','driver','d2',2,'D2','company_car',50,25.5,'10000000876','2026-01-01')$$,
  'motorista valido aceito');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership)
values ('00000000-0000-0000-0000-0000000000c1','Onix','AAA0A00','flex',12.5,'own');

select throws_ok(
  $$insert into shifts (driver_id, car_id, started_at, start_date, odometer_start, odometer_end)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1', now(), current_date, 1000, 900)$$,
  '23514', null, 'odometro final < inicial rejeitado');

insert into driver_periods (id, driver_id, start_date, end_date)
values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a2','2026-09-28','2026-10-12');  -- alinhada ao ciclo de 01/01

select throws_ok(
  $$insert into adjustments (driver_id, driver_period_id, kind, amount, description, effective_date)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','advance',100,'vale','2026-10-05')$$,
  '23514', null, 'advance positivo rejeitado');

select lives_ok(
  $$insert into adjustments (driver_id, driver_period_id, kind, amount, description, effective_date)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000b1','advance',-100,'vale','2026-10-05')$$,
  'advance negativo aceito');

select throws_ok(
  $$insert into driver_periods (driver_id, start_date, end_date) values ('00000000-0000-0000-0000-0000000000a2','2026-09-20','2026-09-01')$$,
  '23514', null, 'end_date antes do start_date rejeitado');

select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000a2','transfer','2026-10-02',100)$$,
  '23514', null, 'transfer sem client_name rejeitado');

select is(driver_period_for('00000000-0000-0000-0000-0000000000a2', '2026-11-16'),
          driver_period_for('00000000-0000-0000-0000-0000000000a2', '2026-11-16'), 'driver_period_for idempotente');

-- ciclo desde 2026-01-01: 2026-11-16 cai na quinzena 01/01 + 15×21 = 12/11 … 26/11
select results_eq(
  $$select start_date, end_date from driver_periods
     where id = driver_period_for('00000000-0000-0000-0000-0000000000a2', '2026-11-16')$$,
  $$values ('2026-11-12'::date, '2026-11-26'::date)$$,
  'quinzena de 2026-11-16 vai de 12/11 a 26/11');

-- cria a quinzena em statement separado (o snapshot da query externa nao veria o insert)
select lives_ok($$select driver_period_for('00000000-0000-0000-0000-0000000000a2', '2026-02-10')$$, 'cria quinzena de fevereiro');

select results_eq(
  $$select start_date, end_date from driver_periods
     where driver_id = '00000000-0000-0000-0000-0000000000a2' and '2026-02-10' between start_date and end_date$$,
  $$values ('2026-01-31'::date, '2026-02-14'::date)$$,
  'quinzena atravessa a virada de mês (31/01–14/02)');

select * from finish();
rollback;
