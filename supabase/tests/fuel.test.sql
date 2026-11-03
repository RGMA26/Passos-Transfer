begin;
select plan(69);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
-- O check em si é testado em transfer_flow.test.sql.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Fixtures próprias (uuids 2xxx). Admin do seed: ad01.
-- Carros: f1 flex (gasolina 10, álcool 7) empresa | f2 diesel 12 empresa | f3 flex sem consumo empresa
--         f4 flex (gasolina 10) próprio | f5 híbrido (gasolina 15, kWh 6) empresa
-- Motoristas: a (f1, ciclo 01/04) | b (f3, ciclo 01/04) | c carro próprio (f4, ciclo 01/04)
--             d (f1, ciclo 01/02) | e (f1, ciclo 01/03) | g (f2, ciclo 01/01) conflito/compatibilidade
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000002a01'), ('00000000-0000-0000-0000-000000002a02'),
  ('00000000-0000-0000-0000-000000002a03'), ('00000000-0000-0000-0000-000000002a04'),
  ('00000000-0000-0000-0000-000000002a05'), ('00000000-0000-0000-0000-000000002a06');

-- ===== Esquema =====
select hasnt_column('public', 'cars', 'consumption_km_l', 'cars.consumption_km_l removida');
select hasnt_column('public', 'shifts', 'consumption_km_l', 'shifts.consumption_km_l removida');
select hasnt_column('public', 'rides', 'consumption_km_l', 'rides.consumption_km_l removida');
select hasnt_column('public', 'fuelings', 'liters', 'fuelings.liters removida');
select has_column('public', 'fuelings', 'quantity', 'fuelings.quantity existe');
select col_type_is('public', 'fuelings', 'quantity', 'numeric(8,3)', 'quantity numeric(8,3)');
select col_type_is('public', 'fuelings', 'unit_price', 'numeric(7,3)', 'unit_price numeric(7,3)');
select col_not_null('public', 'fuelings', 'fuel', 'fuel obrigatório');
select col_not_null('public', 'fuelings', 'photo_path', 'photo_path continua obrigatório');
select col_not_null('public', 'cars', 'fuel_type', 'fuel_type obrigatório');
select col_type_is('public', 'cars', 'km_per_m3_gnv', 'numeric(6,2)', 'km_per_m3_gnv numeric(6,2)');
select hasnt_function('public', 'fuel_price_for', array['uuid','uuid'], 'fuel_price_for removida');
select ok(not has_function_privilege('authenticated', 'cost_per_km_for(uuid,uuid)', 'execute'), 'cost_per_km_for é interno');
select ok(not has_function_privilege('anon', 'cost_per_km_for(uuid,uuid)', 'execute'), 'anon não executa cost_per_km_for');
select ok(not has_function_privilege('authenticated', 'car_consumption(uuid,text)', 'execute'), 'car_consumption é interno');

select throws_ok(
  $$insert into cars (model, plate, fuel_type, ownership) values ('X','FUE9Z99','querosene','company')$$,
  '23514', null, 'fuel_type inválido rejeitado');
select throws_ok(
  $$insert into cars (model, plate, fuel_type, km_per_l_gasolina, ownership) values ('X','FUE9Z98','flex',0,'company')$$,
  '23514', null, 'consumo 0 rejeitado');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, km_per_l_alcool, km_per_l_diesel, km_per_kwh, ownership) values
  ('00000000-0000-0000-0000-000000002cf1','Onix','FUE0A01','flex',10,7,null,null,'company'),
  ('00000000-0000-0000-0000-000000002cf2','S10','FUE0A02','diesel',null,null,12,null,'company'),
  ('00000000-0000-0000-0000-000000002cf3','Gol','FUE0A03','flex',null,null,null,null,'company'),
  ('00000000-0000-0000-0000-000000002cf4','HB20','FUE0A04','flex',10,null,null,null,'own'),
  ('00000000-0000-0000-0000-000000002cf5','Corolla','FUE0A05','hibrido',15,null,null,6,'company');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000002a01','driver','fu-1',9901,'A','company_car',40,30,'00000000-0000-0000-0000-000000002cf1','20000000108','2026-04-01'),
  ('00000000-0000-0000-0000-000000002a02','driver','fu-2',9902,'B','company_car',40,30,'00000000-0000-0000-0000-000000002cf3','20000000299','2026-04-01'),
  ('00000000-0000-0000-0000-000000002a03','driver','fu-3',9903,'C','own_car',null,30,'00000000-0000-0000-0000-000000002cf4','20000000370','2026-04-01'),
  ('00000000-0000-0000-0000-000000002a04','driver','fu-4',9904,'D','company_car',40,30,'00000000-0000-0000-0000-000000002cf1','20000000450','2026-02-01'),
  ('00000000-0000-0000-0000-000000002a05','driver','fu-5',9905,'E','company_car',40,30,'00000000-0000-0000-0000-000000002cf1','20000000531','2026-03-01'),
  ('00000000-0000-0000-0000-000000002a06','driver','fu-6',9906,'G','company_car',40,30,'00000000-0000-0000-0000-000000002cf2','20000000612','2026-01-01');

-- ===== car_consumption =====
select is(car_consumption('00000000-0000-0000-0000-000000002cf1','gasolina'), 10.00::numeric, 'consumo gasolina do flex');
select is(car_consumption('00000000-0000-0000-0000-000000002cf1','alcool'), 7.00::numeric, 'consumo álcool do flex');
select is(car_consumption('00000000-0000-0000-0000-000000002cf3','gasolina'), null::numeric, 'sem consumo cadastrado: nulo');
select is(car_consumption('00000000-0000-0000-0000-000000002cf5','eletrico'), 6.00::numeric, 'consumo kWh do híbrido');

-- ===== Conflito de valores (40 × 6,19 = 247,60) =====
insert into fuelings (id, driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000002f01','00000000-0000-0000-0000-000000002a06','00000000-0000-0000-0000-000000002cf2','2026-01-05','diesel',247.60,40,6.19,'x'),
  ('00000000-0000-0000-0000-000000002f02','00000000-0000-0000-0000-000000002a06','00000000-0000-0000-0000-000000002cf2','2026-01-05','diesel',247.65,40,6.19,'x'),
  ('00000000-0000-0000-0000-000000002f03','00000000-0000-0000-0000-000000002a06','00000000-0000-0000-0000-000000002cf2','2026-01-05','diesel',274.60,40,6.19,'x');
select is((select values_conflict from fuelings where id = '00000000-0000-0000-0000-000000002f01'), false, 'conflito: 247,60 bate');
select is((select values_conflict from fuelings where id = '00000000-0000-0000-0000-000000002f02'), false, 'conflito: 247,65 dentro da tolerância');
select is((select values_conflict from fuelings where id = '00000000-0000-0000-0000-000000002f03'), true, 'conflito: 274,60 conflita');
select is((select km_equivalent from fuelings where id = '00000000-0000-0000-0000-000000002f01'), 480::numeric, 'km_equivalent diesel 40 × 12');
update fuelings set amount = 247.60 where id = '00000000-0000-0000-0000-000000002f03';
select is((select values_conflict from fuelings where id = '00000000-0000-0000-0000-000000002f03'), false, 'conflito recalculado na edição');
update fuelings set values_conflict = true, km_equivalent = 1 where id = '00000000-0000-0000-0000-000000002f01';
select is((select values_conflict::text || '/' || km_equivalent::text from fuelings where id = '00000000-0000-0000-0000-000000002f01'),
  'false/480.000', 'campos calculados não aceitam valor manual');

-- ===== Combustível compatível com o carro =====
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a06','00000000-0000-0000-0000-000000002cf2','2026-01-06','alcool',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'álcool num carro diesel');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-06','diesel',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'diesel num carro flex');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf5','2026-04-06','alcool',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'álcool num híbrido');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-06','querosene',50,10,5,'x')$$,
  'P0001', 'FUEL_NOT_ALLOWED', 'combustível desconhecido');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-06','gasolina',50,0,5,'x')$$,
  '23514', null, 'quantidade 0 rejeitada');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-06','gasolina',50,10,0,'x')$$,
  '23514', null, 'preço por unidade 0 rejeitado');
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf5','2026-04-06','eletrico',30,10,3,'x')$$,
  'elétrico num híbrido');
select is((select km_equivalent from fuelings where car_id = '00000000-0000-0000-0000-000000002cf5'), 60::numeric, 'km_equivalent 10 kWh × 6');
delete from fuelings where car_id = '00000000-0000-0000-0000-000000002cf5';

-- ===== a: flex com gasolina 10 km/l, nota 100,00 / 16 L; turno 1000→1200, serviço 180, por fora 20 =====
insert into fuelings (id, driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000002fa1','00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-05','gasolina',100,16,6.25,'x','approved'),
  ('00000000-0000-0000-0000-000000002fa2','00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-06','alcool',70,14,5,'x','pending');
select is((select km_equivalent from fuelings where id = '00000000-0000-0000-0000-000000002fa1'), 160::numeric, 'km_equivalent 16 L × 10');
select is((select km_equivalent from fuelings where id = '00000000-0000-0000-0000-000000002fa2'), 98::numeric, 'km_equivalent álcool 14 L × 7');
insert into shifts (id, driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-000000002b01','00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf1','2026-04-05',1000);
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-000000002a01','uber','2026-04-05',100,180);
update shifts set ended_at = '2026-04-05 20:00-03', odometer_end = 1200 where id = '00000000-0000-0000-0000-000000002b01';

create temp table pa as select driver_period_for('00000000-0000-0000-0000-000000002a01','2026-04-05') as id;
grant select on pa to authenticated;
select is(cost_per_km_for('00000000-0000-0000-0000-000000002a01', (select id from pa)),
  '{"cost_per_km":0.625,"source":"period","missing_consumption":false}'::jsonb, 'custo por km da quinzena');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
create temp table sa as select compute_statement('00000000-0000-0000-0000-000000002a01', (select id from pa)) as j;
select is((select (j->>'off_duty_fuel_discount')::numeric from sa), 12.50, 'a: desconto 20 km × 0,625');
select is((select (j->>'fuel_reimbursement')::numeric from sa), 100.00, 'a: reembolso do carro da empresa');
select is((select (j->>'cost_per_km')::numeric from sa), 0.625, 'a: cost_per_km no extrato');
select is((select (j->>'missing_consumption')::boolean from sa), false, 'a: consumo presente');
select is((select (j->>'missing_fuel_price')::boolean from sa), false, 'a: preço presente');
select is((select (j->>'total')::numeric from sa), 127.50, 'a: total 40 + 100 − 12,50');
reset role;

-- ===== b: carro sem consumo =====
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000002a02','00000000-0000-0000-0000-000000002cf3','2026-04-05','gasolina',100,16,6.25,'x','approved');
insert into shifts (id, driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-000000002b02','00000000-0000-0000-0000-000000002a02','00000000-0000-0000-0000-000000002cf3','2026-04-05',5000,'2026-04-05 20:00-03',5020);
select is((select km_equivalent from fuelings where driver_id = '00000000-0000-0000-0000-000000002a02'), null::numeric, 'sem consumo: km_equivalent nulo');
create temp table pb as select driver_period_for('00000000-0000-0000-0000-000000002a02','2026-04-05') as id;
grant select on pb to authenticated;
set local role authenticated;
create temp table sb as select compute_statement('00000000-0000-0000-0000-000000002a02', (select id from pb)) as j;
select is((select (j->>'missing_consumption')::boolean from sb), true, 'sem consumo: missing_consumption');
select is((select (j->>'off_duty_fuel_discount')::numeric from sb), 0::numeric, 'sem consumo: desconto 0');
select is((select (j->>'missing_fuel_price')::boolean from sb), false, 'sem consumo: não é falta de nota');
select is((select j->'cost_per_km' from sb), 'null'::jsonb, 'sem consumo: cost_per_km nulo');
reset role;

-- ===== c: carro próprio — reembolso 0 e Transfer 50 km × 0,625 =====
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000002a03','00000000-0000-0000-0000-000000002cf4','2026-04-05','gasolina',100,16,6.25,'x','approved');
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status, car_id) values
  ('00000000-0000-0000-0000-000000002a03','transfer','2026-04-05',200,50,'Cli','completed','00000000-0000-0000-0000-000000002cf4');
create temp table pc as select driver_period_for('00000000-0000-0000-0000-000000002a03','2026-04-05') as id;
grant select on pc to authenticated;
set local role authenticated;
create temp table sc as select compute_statement('00000000-0000-0000-0000-000000002a03', (select id from pc)) as j;
select is((select (j->>'fuel_reimbursement')::numeric from sc), 0::numeric, 'carro próprio: abastecimento não reembolsa');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from sc), 31.25, 'carro próprio: Transfer 50 km × 0,625');
select is((select (j->>'total')::numeric from sc), 91.25, 'carro próprio: total 60 + 31,25');
reset role;

-- ===== Reservas: d (driver_last) e e (company_last) =====
-- d: nota aprovada 120 / 20 L (200 km) em 10/02, na 1ª quinzena; a 2ª quinzena (16/02–02/03) não tem nota
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000002a04','00000000-0000-0000-0000-000000002cf1','2026-02-10','gasolina',120,20,6,'x','approved'),
  ('00000000-0000-0000-0000-000000002a04','00000000-0000-0000-0000-000000002cf1','2026-02-11','gasolina',500,50,10,'x','rejected');
create temp table pd as select driver_period_for('00000000-0000-0000-0000-000000002a04','2026-02-20') as id;
select is(cost_per_km_for('00000000-0000-0000-0000-000000002a04', (select id from pd)),
  '{"cost_per_km":0.6,"source":"driver_last","missing_consumption":false}'::jsonb, 'reserva: última nota do motorista');
-- e: nunca abasteceu; quinzena 01/03–15/03 → última nota da empresa até 15/03 (a de d)
create temp table pe as select driver_period_for('00000000-0000-0000-0000-000000002a05','2026-03-05') as id;
grant select on pe to authenticated;
select is(cost_per_km_for('00000000-0000-0000-0000-000000002a05', (select id from pe)),
  '{"cost_per_km":0.6,"source":"company_last","missing_consumption":false}'::jsonb, 'reserva: última nota da empresa');
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-000000002a05','00000000-0000-0000-0000-000000002cf1','2026-03-05',100,'2026-03-05 20:00-03',150);
set local role authenticated;
select is((compute_statement('00000000-0000-0000-0000-000000002a05', (select id from pe))->>'off_duty_fuel_discount')::numeric,
  30.00, 'reserva da empresa: 50 km × 0,60');
reset role;
-- g (ciclo 01/01): quinzena 16/01–30/01 sem nota; antes de 30/01 só há notas pendentes (de g) → sem preço
create temp table pg as select driver_period_for('00000000-0000-0000-0000-000000002a06','2026-01-20') as id;
select is(cost_per_km_for('00000000-0000-0000-0000-000000002a06', (select id from pg)),
  '{"cost_per_km":null,"source":null,"missing_consumption":false}'::jsonb, 'sem nota aprovada: nulo');

-- ===== start_shift: odômetro mínimo do carro =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000002a01","role":"authenticated"}';
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-000000002b11','00000000-0000-0000-0000-000000002cf1',900,'p.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'start_shift abaixo do último odômetro do carro');
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-000000002b11','00000000-0000-0000-0000-000000002cf1',1200,'p.jpg')$$,
  'start_shift igual ao último odômetro');
reset role;

-- ===== Consumo cadastrado/alterado depois: custo calculado na hora =====
-- h (2a07): carro f6 flex sem consumo; turno 2000→2020 (20 km por fora)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
insert into auth.users (id) values ('00000000-0000-0000-0000-000000002a07'), ('00000000-0000-0000-0000-000000002a08');
insert into cars (id, model, plate, fuel_type, ownership) values
  ('00000000-0000-0000-0000-000000002cf6','Argo','FUE0A06','flex','company');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000002a07','driver','fu-7',9907,'H','company_car',40,30,'00000000-0000-0000-0000-000000002cf6','20000000701','2026-04-01'),
  ('00000000-0000-0000-0000-000000002a08','driver','fu-8',9908,'I','company_car',40,30,'00000000-0000-0000-0000-000000002cf1','20000000884','2026-04-20');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000002a07','00000000-0000-0000-0000-000000002cf6','2026-04-05','gasolina',100,16,6.25,'x','approved');
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-000000002a07','00000000-0000-0000-0000-000000002cf6','2026-04-05',2000,'2026-04-05 20:00-03',2020);
create temp table ph as select driver_period_for('00000000-0000-0000-0000-000000002a07','2026-04-05') as id;
grant select on ph to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select is((compute_statement('00000000-0000-0000-0000-000000002a07', (select id from ph))->>'missing_consumption')::boolean,
  true, 'consumo depois: antes de cadastrar, missing_consumption');
reset role;
update cars set km_per_l_gasolina = 10 where id = '00000000-0000-0000-0000-000000002cf6';
set local role authenticated;
select is((compute_statement('00000000-0000-0000-0000-000000002a07', (select id from ph))->>'missing_consumption')::boolean,
  false, 'consumo depois: cadastrado vale para a nota já aprovada');
select is((compute_statement('00000000-0000-0000-0000-000000002a07', (select id from ph))->>'off_duty_fuel_discount')::numeric,
  12.50, 'consumo depois: desconto 20 × 0,625');
reset role;
-- segunda nota gravada com 10 km/l (km_equivalent 100); a primeira continua com km_equivalent nulo gravado
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000002a07','00000000-0000-0000-0000-000000002cf6','2026-04-07','gasolina',50,10,5,'x','approved');
select is((cost_per_km_for('00000000-0000-0000-0000-000000002a07', (select id from ph))->>'cost_per_km')::numeric,
  150 / 260::numeric, 'consumo depois: 150 ÷ (16 + 10) × 10, sem usar o km_equivalent gravado');
update cars set km_per_l_gasolina = 12 where id = '00000000-0000-0000-0000-000000002cf6';
select is((cost_per_km_for('00000000-0000-0000-0000-000000002a07', (select id from ph))->>'cost_per_km')::numeric,
  150 / 312::numeric, 'consumo alterado 10 → 12 vale para todas as notas da quinzena');
set local role authenticated;
select is((compute_statement('00000000-0000-0000-0000-000000002a07', (select id from ph))->>'off_duty_fuel_discount')::numeric,
  9.62, 'consumo alterado: desconto 20 × 150 ÷ 312');
reset role;
-- i (2a08, carro f1 10 km/l, quinzena 20/04–04/05) sem nota: reserva da empresa = nota de h em 07/04,
-- convertida pelo consumo do carro da nota (f6, 12 km/l): 50 ÷ 120
create temp table pi as select driver_period_for('00000000-0000-0000-0000-000000002a08','2026-04-25') as id;
select is(cost_per_km_for('00000000-0000-0000-0000-000000002a08', (select id from pi))->>'source', 'company_last',
  'reserva da empresa com carro diferente: fonte');
select is((cost_per_km_for('00000000-0000-0000-0000-000000002a08', (select id from pi))->>'cost_per_km')::numeric,
  50 / 120::numeric, 'reserva da empresa usa o consumo do carro da nota (12), não o do motorista (10)');

-- ===== Motorista só lança abastecimento do carro atual =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000002a01","role":"authenticated"}';
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values (auth.uid(),'00000000-0000-0000-0000-000000002cf6','2026-04-07','gasolina',50,10,5,'x')$$,
  'P0001', 'FUEL_CAR_NOT_ALLOWED', 'motorista não lança abastecimento de outro carro');
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values (auth.uid(),'00000000-0000-0000-0000-000000002cf1','2026-04-07','gasolina',50,10,5,'x')$$,
  'motorista lança abastecimento do carro atual');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
    values ('00000000-0000-0000-0000-000000002a01','00000000-0000-0000-0000-000000002cf6','2026-04-07','gasolina',50,10,5,'x')$$,
  'admin lança abastecimento de qualquer carro');
reset role;

select * from finish();
rollback;
