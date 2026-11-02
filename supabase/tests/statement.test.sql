-- SKIP TEMPORÁRIO (0010): depende de periods/close_period/period_summary, removidos na 0010.
-- Task 2 reescreve este arquivo sobre driver_periods. O conteúdo original segue abaixo, comentado.
begin;
select plan(1);
select skip('statement.test.sql: aguardando Task 2 (quinzenas por motorista)', 1);
select * from finish();
rollback;

/* ===== ORIGINAL (desativado) =====
begin;
select plan(84);

-- Fixtures próprias (uuids 6xx, seq 96xx). Admin do seed: ad01.
-- d1 cenário completo | d2 mudança de % | d3 carro próprio | d4 km negativo
-- d5 sem abastecimento | d6 arredondamento | d7 transfer assigned | d8 turno noturno
-- d9 end_shift com estimativa | da inativo
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000006d1'), ('00000000-0000-0000-0000-0000000006d2'),
  ('00000000-0000-0000-0000-0000000006d3'), ('00000000-0000-0000-0000-0000000006d4'),
  ('00000000-0000-0000-0000-0000000006d5'), ('00000000-0000-0000-0000-0000000006d6'),
  ('00000000-0000-0000-0000-0000000006d7'), ('00000000-0000-0000-0000-0000000006d8'),
  ('00000000-0000-0000-0000-0000000006d9'), ('00000000-0000-0000-0000-0000000006da');

insert into cars (id, model, plate, consumption_km_l, ownership) values
  ('00000000-0000-0000-0000-0000000006c1','Onix','STM0A01',10.0,'company'),
  ('00000000-0000-0000-0000-0000000006c2','HB20','STM0B02',12.5,'own');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active) values
  ('00000000-0000-0000-0000-0000000006d1','driver','stm-1',9601,'D1','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d2','driver','stm-2',9602,'D2','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d3','driver','stm-3',9603,'D3','own_car',null,30,'00000000-0000-0000-0000-0000000006c2',true),
  ('00000000-0000-0000-0000-0000000006d4','driver','stm-4',9604,'D4','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d5','driver','stm-5',9605,'D5','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d6','driver','stm-6',9606,'D6','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d7','driver','stm-7',9607,'D7','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d8','driver','stm-8',9608,'D8','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006d9','driver','stm-9',9609,'D9','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006da','driver','stm-a',9610,'DA','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',false);

insert into periods (id, start_date, end_date, reference_fuel_price) values
  ('00000000-0000-0000-0000-000000006e01','2026-04-01','2026-04-15',null),
  ('00000000-0000-0000-0000-000000006e02','2026-05-01','2026-05-15',6.00),
  ('00000000-0000-0000-0000-000000006e03','2026-06-01','2026-06-15',6.00),
  ('00000000-0000-0000-0000-000000006e04','2026-06-16','2026-06-30',null);

-- Turnos abertos (corridas Uber/BlaBlaCar exigem turno aberto); encerrados depois
insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000006b1','00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006c1',10,'2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b2','00000000-0000-0000-0000-0000000006d2','00000000-0000-0000-0000-0000000006c1',10,'2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b4','00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-0000000006c1',10,'2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b6','00000000-0000-0000-0000-0000000006d6','00000000-0000-0000-0000-0000000006c1',10,'2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b8','00000000-0000-0000-0000-0000000006d8','00000000-0000-0000-0000-0000000006c1',10,'2026-06-15',1000);

-- ===== d1: cenário completo carro da empresa =====
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006d1','uber','2026-04-05',100,50),
  ('00000000-0000-0000-0000-0000000006d1','uber','2026-04-05',50,30),
  ('00000000-0000-0000-0000-0000000006d1','blablacar','2026-04-05',80,70);
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006a1','00000000-0000-0000-0000-0000000006d1',
   'transfer','2026-04-05',300,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, amount, liters, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006c1','2026-04-05',100,16,'x','approved'),
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006c1','2026-04-06',50,8,'x','pending');
insert into ride_expenses (ride_id, kind, amount, photo_path, review_status, reject_reason) values
  ('00000000-0000-0000-0000-0000000006a1','toll',15.50,'x','approved',null),
  ('00000000-0000-0000-0000-0000000006a1','parking',20.00,'x','rejected','sem nota');
insert into adjustments (driver_id, period_id, kind, amount, description) values
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01','advance',-50,'vale'),
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01','bonus',10,'bônus');
-- o motorista conclui o transfer com o turno aberto (liga shift_id); depois o turno encerra
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d1","role":"authenticated"}';
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a1', 30)$$, 'd1 conclui transfer no turno');
reset role;
update shifts set ended_at = '2026-04-05 20:00-03', odometer_end = 1200
  where id = '00000000-0000-0000-0000-0000000006b1';

-- ===== d2: mudança de % no meio da quinzena =====
insert into rides (driver_id, platform, ride_date, amount) values
  ('00000000-0000-0000-0000-0000000006d2','uber','2026-04-05',100);
update profiles set uber_pct = 50 where id = '00000000-0000-0000-0000-0000000006d2';
insert into rides (driver_id, platform, ride_date, amount) values
  ('00000000-0000-0000-0000-0000000006d2','uber','2026-04-10',100);

-- ===== d3: carro próprio =====
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006d3','transfer','2026-05-05',200,50,'Cli','completed');

-- ===== d4: km negativo =====
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006d4','blablacar','2026-04-05',50,120);
update shifts set ended_at = '2026-04-05 20:00-03', odometer_end = 1100
  where id = '00000000-0000-0000-0000-0000000006b4';

-- ===== d5: sem abastecimento (20 km por fora) em quinzena com e sem referência =====
insert into shifts (driver_id, car_id, consumption_km_l, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-0000000006c1',10,'2026-05-05',1000,'2026-05-05 20:00-03',1020),
  ('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-0000000006c1',10,'2026-04-05',2000,'2026-04-05 20:00-03',2020);

-- ===== d6: arredondamento =====
insert into rides (driver_id, platform, ride_date, amount) values
  ('00000000-0000-0000-0000-0000000006d6','uber','2026-04-05',33.33),
  ('00000000-0000-0000-0000-0000000006d6','uber','2026-04-05',33.33),
  ('00000000-0000-0000-0000-0000000006d6','uber','2026-04-05',33.33);

-- ===== d7: transfer assigned (com despesa aprovada) não entra =====
insert into rides (id, driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006a7','00000000-0000-0000-0000-0000000006d7','transfer','2026-04-05',500,40,'Cli','assigned');
insert into ride_expenses (ride_id, kind, amount, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000006a7','toll',12,'x','approved'),
  ('00000000-0000-0000-0000-0000000006a7','toll',8,'x','pending');

-- ===== d8: turno das 22h do dia 15 até 02h do dia 16 =====
update shifts set started_at = '2026-06-15 22:00-03' where id = '00000000-0000-0000-0000-0000000006b8';
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006d8','uber','2026-06-16',100,30);
update shifts set ended_at = '2026-06-16 02:00-03', odometer_end = 1100
  where id = '00000000-0000-0000-0000-0000000006b8';

-- ===== d9: end_shift com estimativa (abastecimento aprovado na quinzena de hoje) =====
insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start, odometer_start_photo) values
  ('00000000-0000-0000-0000-0000000006b9','00000000-0000-0000-0000-0000000006d9','00000000-0000-0000-0000-0000000006c1',10,
   (now() at time zone 'America/Sao_Paulo')::date,1000,'p.jpg');
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006a9','00000000-0000-0000-0000-0000000006d9','transfer',
   (now() at time zone 'America/Sao_Paulo')::date,100,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, amount, liters, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000006d9','00000000-0000-0000-0000-0000000006c1',
   (now() at time zone 'America/Sao_Paulo')::date,60,10,'x','approved');

-- ===== Privilégios =====
select ok(not has_function_privilege('anon', 'compute_statement(uuid,uuid)', 'execute'), 'anon não executa compute_statement');
select ok(has_function_privilege('authenticated', 'compute_statement(uuid,uuid)', 'execute'), 'authenticated executa compute_statement');
select ok(not has_function_privilege('authenticated', 'fuel_price_for(uuid,uuid)', 'execute'), 'fuel_price_for é interno');
select ok(not has_function_privilege('anon', 'fuel_price_for(uuid,uuid)', 'execute'), 'anon não executa fuel_price_for');

select is((select shift_id from rides where id = '00000000-0000-0000-0000-0000000006a1'),
  '00000000-0000-0000-0000-0000000006b1'::uuid, 'transfer da empresa ligado ao turno aberto');

-- ===== Cenário completo (como admin) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';

create temp table st1 as
  select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01') as j;
select is((select (j->>'uber_share')::numeric from st1), 60.00, 'completo: uber_share');
select is((select (j->>'transfer_share')::numeric from st1), 90.00, 'completo: transfer_share');
select is((select (j->>'fuel_reimbursement')::numeric from st1), 100.00, 'completo: fuel_reimbursement');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from st1), 0::numeric, 'completo: transfer_fuel_reimbursement');
select is((select (j->>'expense_reimbursement')::numeric from st1), 15.50, 'completo: expense_reimbursement (recusada fora)');
select is((select (j->>'avg_fuel_price')::numeric from st1), 6.25, 'completo: avg_fuel_price');
select is((select (j->>'off_duty_fuel_discount')::numeric from st1), 12.50, 'completo: off_duty_fuel_discount');
select is((select (j->>'adjustments')::numeric from st1), -40.00, 'completo: adjustments');
select is((select (j->>'total')::numeric from st1), 213.00, 'completo: total');
select is((select (j->'pending'->>'fuelings')::numeric from st1), 50.00, 'completo: pending.fuelings');
select is((select (j->'pending'->>'expenses')::numeric from st1), 0::numeric, 'completo: pending.expenses');
select is((select j->'km' from st1), '{"total":200,"service":180,"off":20}'::jsonb, 'completo: km');
select is((select (j->>'missing_reference_price')::boolean from st1), false, 'completo: preço médio dispensa referência');
select is((select jsonb_typeof(j->'total') from st1), 'number', 'valores são números');
select is(
  (select array(select jsonb_object_keys(j) order by 1) from st1),
  array['adjustments','avg_fuel_price','expense_reimbursement','fuel_reimbursement','km',
        'missing_reference_price','off_duty_fuel_discount','pending','total',
        'transfer_fuel_reimbursement','transfer_share','uber_share'],
  'formato do extrato');

-- ===== Mudança de % =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d2','00000000-0000-0000-0000-000000006e01')->>'uber_share')::numeric,
  90.00, '% muda no meio da quinzena: uber_share');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d2','00000000-0000-0000-0000-000000006e01')->'km'),
  '{"total":0,"service":0,"off":0}'::jsonb, 'turno aberto não conta km');

-- ===== Carro próprio =====
create temp table st3 as
  select compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e02') as j;
select is((select (j->>'transfer_share')::numeric from st3), 60.00, 'carro próprio: transfer_share');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from st3), 24.00, 'carro próprio: transfer_fuel_reimbursement');
select is((select (j->>'off_duty_fuel_discount')::numeric from st3), 0::numeric, 'carro próprio: off_duty_fuel_discount');
select is((select (j->>'total')::numeric from st3), 84.00, 'carro próprio: total');
select is((select (j->>'missing_reference_price')::boolean from st3), false, 'carro próprio: referência presente');
-- carro próprio sem referência
reset role;
update rides set ride_date = '2026-04-05' where driver_id = '00000000-0000-0000-0000-0000000006d3';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e01')->>'missing_reference_price')::boolean,
  true, 'carro próprio sem referência: flag');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e01')->>'transfer_fuel_reimbursement')::numeric,
  0::numeric, 'carro próprio sem referência: reembolso 0');

-- ===== km negativo =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-000000006e01')->>'off_duty_fuel_discount')::numeric,
  0::numeric, 'km negativo: desconto 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-000000006e01')->'km'),
  '{"total":100,"service":120,"off":0}'::jsonb, 'km negativo: off 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-000000006e01')->>'missing_reference_price')::boolean,
  false, 'km negativo: sem km por fora não exige referência');

-- ===== Sem abastecimento =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e02')->>'off_duty_fuel_discount')::numeric,
  12.00, 'sem abastecimento: usa referência');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e02')->>'avg_fuel_price')::numeric,
  6.000, 'sem abastecimento: avg = referência');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e02')->>'total')::numeric,
  -12.00, 'sem abastecimento: total negativo');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e01')->>'missing_reference_price')::boolean,
  true, 'referência nula: flag');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e01')->>'off_duty_fuel_discount')::numeric,
  0::numeric, 'referência nula: desconto com preço 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e01')->>'avg_fuel_price')::numeric,
  0::numeric, 'referência nula: avg 0');

-- ===== Arredondamento =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d6','00000000-0000-0000-0000-000000006e01')->>'uber_share')::numeric,
  40.00, 'arredonda depois de somar');

-- ===== Transfer assigned =====
create temp table st7 as
  select compute_statement('00000000-0000-0000-0000-0000000006d7','00000000-0000-0000-0000-000000006e01') as j;
select is((select (j->>'transfer_share')::numeric from st7), 0::numeric, 'assigned: transfer_share 0');
select is((select (j->>'expense_reimbursement')::numeric from st7), 0::numeric, 'assigned: despesa não entra');
select is((select (j->'pending'->>'expenses')::numeric from st7), 0::numeric, 'assigned: pendente não entra');
select is((select (j->>'total')::numeric from st7), 0::numeric, 'assigned: total 0');
-- concluído passa a contar (e a despesa pendente aparece em pending)
reset role;
update rides set transfer_status = 'completed' where id = '00000000-0000-0000-0000-0000000006a7';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d7','00000000-0000-0000-0000-000000006e01')->>'total')::numeric,
  162.00, 'completed: 150 + despesa 12');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d7','00000000-0000-0000-0000-000000006e01')->'pending'->>'expenses')::numeric,
  8.00, 'completed: despesa pendente em pending');

-- ===== Turno noturno 15→16 =====
create temp table st8a as
  select compute_statement('00000000-0000-0000-0000-0000000006d8','00000000-0000-0000-0000-000000006e03') as j;
create temp table st8b as
  select compute_statement('00000000-0000-0000-0000-0000000006d8','00000000-0000-0000-0000-000000006e04') as j;
select is((select j->'km' from st8a), '{"total":100,"service":30,"off":70}'::jsonb, 'noturno: km na quinzena do início');
select is((select (j->>'off_duty_fuel_discount')::numeric from st8a), 42.00, 'noturno: desconto na quinzena 1–15');
select is((select (j->>'uber_share')::numeric from st8a), 0::numeric, 'noturno: Uber não entra em 1–15');
select is((select (j->>'uber_share')::numeric from st8b), 40.00, 'noturno: Uber entra em 16–fim');
select is((select j->'km' from st8b), '{"total":0,"service":0,"off":0}'::jsonb, 'noturno: km não entra em 16–fim');
select is((select (j->>'off_duty_fuel_discount')::numeric from st8b), 0::numeric, 'noturno: sem desconto em 16–fim');

-- ===== Acesso =====
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006ff')$$,
  'P0001', 'NOT_FOUND', 'quinzena inexistente');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d1","role":"authenticated"}';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01')->>'total')::numeric,
  213.00, 'motorista calcula o próprio extrato');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d2","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01')$$,
  'P0001', 'FORBIDDEN', 'motorista B não calcula o extrato de A');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006da","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006da','00000000-0000-0000-0000-000000006e01')$$,
  'P0001', 'FORBIDDEN', 'motorista inativo não calcula');
select throws_ok(
  $$select fuel_price_for('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01')$$,
  '42501', null, 'fuel_price_for negado a authenticated');
reset role;

-- ===== fuel_price_for (como postgres) =====
select is(fuel_price_for('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e01'), 6.25::numeric, 'fuel_price_for: média aprovada');
select is(fuel_price_for('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e02'), 6.00::numeric, 'fuel_price_for: referência');
select is(fuel_price_for('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e01'), null::numeric, 'fuel_price_for: nulo');

-- ===== end_shift com estimativa (transfer de 5 km conta como serviço) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d9","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a9', 5)$$, 'd9 conclui transfer no turno');
select is(
  end_shift('00000000-0000-0000-0000-0000000006b9',1020,'f.jpg',null),
  '{"km_total":20,"km_service":5,"km_off":15,"off_discount_estimate":9.00}'::jsonb,
  'end_shift soma o transfer no km em serviço e estima o desconto');
select is(
  end_shift('00000000-0000-0000-0000-0000000006b9',1500,'z.jpg',null),
  '{"km_total":20,"km_service":5,"km_off":15,"off_discount_estimate":9.00}'::jsonb,
  'end_shift repetido mantém a estimativa');
-- turno encerrado: carro da empresa não conclui transfer
reset role;
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006aa','00000000-0000-0000-0000-0000000006d9','transfer','2026-07-01',100,'Cli','assigned'),
  ('00000000-0000-0000-0000-0000000006a3','00000000-0000-0000-0000-0000000006d3','transfer','2026-07-01',100,'Cli','assigned');
set local role authenticated;
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000006aa', 10)$$,
  'P0001', 'NO_OPEN_SHIFT', 'carro da empresa sem turno aberto');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000006aa'), 'assigned', 'falha não conclui');
reset role;
-- carro próprio: conclui sem turno, shift_id nulo
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d3","role":"authenticated"}';
set local role authenticated;
select is((select shift_id::text from complete_transfer('00000000-0000-0000-0000-0000000006a3', 10)), null, 'carro próprio: shift_id nulo');
reset role;
select is((select transfer_status || '/' || coalesce(consumption_km_l::text, 'null') from rides where id = '00000000-0000-0000-0000-0000000006a3'),
  'completed/12.50', 'carro próprio: concluído com snapshot de consumo');

-- ===== reenvio mantém o turno original (6a9 concluído no turno 6b9, já encerrado) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006a9',false,'km errado')$$, 'admin recusa transfer');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d9","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a9', 6)$$, 'reenvio sem turno aberto funciona');
select is((select shift_id from rides where id = '00000000-0000-0000-0000-0000000006a9'),
  '00000000-0000-0000-0000-0000000006b9'::uuid, 'reenvio mantém o turno original');
-- abre um turno novo (S2) e reenvia de novo: continua no turno original
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000006ba','00000000-0000-0000-0000-0000000006c1',1500,'p.jpg')$$,
  'd9 abre turno novo');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006a9',false,'de novo')$$, 'admin recusa de novo');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d9","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a9', 7)$$, 'reenvio com turno novo aberto');
select is((select shift_id::text || '/' || km::text from rides where id = '00000000-0000-0000-0000-0000000006a9'),
  '00000000-0000-0000-0000-0000000006b9/7.0', 'turno novo aberto não reaponta o transfer');
reset role;

-- ===== transfer recusado e reatribuído: km não vaza para o turno do motorista anterior =====
-- db ("João", carro da empresa, turno 6bb) | dc ("Maria", carro da empresa, turno 6bc); quinzena e02 (ref 6.00)
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000006db'), ('00000000-0000-0000-0000-0000000006dc');
insert into cars (id, model, plate, consumption_km_l, ownership) values
  ('00000000-0000-0000-0000-0000000006c3','Onix','STM0C03',10.0,'company');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active) values
  ('00000000-0000-0000-0000-0000000006db','driver','stm-b',9611,'DB','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true),
  ('00000000-0000-0000-0000-0000000006dc','driver','stm-c',9612,'DC','company_car',40,30,'00000000-0000-0000-0000-0000000006c3',true);
insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000006bb','00000000-0000-0000-0000-0000000006db','00000000-0000-0000-0000-0000000006c1',10,'2026-05-05',1000),
  ('00000000-0000-0000-0000-0000000006bc','00000000-0000-0000-0000-0000000006dc','00000000-0000-0000-0000-0000000006c3',10,'2026-05-05',1000);
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006db','uber','2026-05-05',100,20);
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006ab','00000000-0000-0000-0000-0000000006db','transfer','2026-05-05',100,'Cli','assigned'),
  ('00000000-0000-0000-0000-0000000006ac','00000000-0000-0000-0000-0000000006db','transfer','2026-05-05',200,'Cli','assigned');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006db","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006ab', 40)$$, 'João conclui transfer T');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006ac', 30)$$, 'João conclui transfer U');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006ab',false,'errado')$$, 'admin recusa T');
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006ac',false,'errado')$$, 'admin recusa U (fica assigned com km 30)');
select lives_ok(
  $$update rides set driver_id = '00000000-0000-0000-0000-0000000006dc' where id = '00000000-0000-0000-0000-0000000006ab'$$,
  'admin reatribui T para Maria');
reset role;
select is((select shift_id from rides where id = '00000000-0000-0000-0000-0000000006ab'), null::uuid,
  'reatribuição solta o turno do João');
-- defesa: shift_id inconsistente (turno de outro motorista) é ignorado ao concluir
update rides set shift_id = '00000000-0000-0000-0000-0000000006bb' where id = '00000000-0000-0000-0000-0000000006ab';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006dc","role":"authenticated"}';
set local role authenticated;
select is((select shift_id from complete_transfer('00000000-0000-0000-0000-0000000006ab', 50)),
  '00000000-0000-0000-0000-0000000006bc'::uuid, 'Maria conclui T no próprio turno (turno alheio ignorado)');
reset role;
-- defesa: mesmo com shift_id inconsistente, as somas exigem motorista da corrida = do turno
update rides set shift_id = '00000000-0000-0000-0000-0000000006bb' where id = '00000000-0000-0000-0000-0000000006ab';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006db","role":"authenticated"}';
set local role authenticated;
select is(
  end_shift('00000000-0000-0000-0000-0000000006bb',1100,'f.jpg','u.jpg'),
  '{"km_total":100,"km_service":20,"km_off":80,"off_discount_estimate":48.00}'::jsonb,
  'end_shift do João: só o Uber (sem km da Maria nem do transfer recusado)');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006db','00000000-0000-0000-0000-000000006e02')->'km'),
  '{"total":100,"service":20,"off":80}'::jsonb, 'extrato do João: km em serviço sem T nem U');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006db','00000000-0000-0000-0000-000000006e02')->>'off_duty_fuel_discount')::numeric,
  48.00, 'extrato do João: desconto inalterado pelo km da Maria');
reset role;

select * from finish();
rollback;

===== FIM ORIGINAL ===== */
