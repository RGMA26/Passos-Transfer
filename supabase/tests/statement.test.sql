begin;
select plan(96);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
-- O check em si é testado em transfer_flow.test.sql.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Fixtures próprias (uuids 6xx, seq 96xx). Admin do seed: ad01.
-- d1 cenário completo | d2 mudança de % | d3 carro próprio | d4 km negativo
-- d5 sem abastecimento | d6 arredondamento | d7 transfer assigned | d8 turno noturno
-- d9 end_shift com estimativa | da inativo
-- Custo por km (0011): única nota aprovada até julho é a de d1 (100,00 / 16 L × 10 km/l = 160 km
-- → 0,625/km); quem não tem nota usa a última da empresa (reserva company_last).
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000006d1'), ('00000000-0000-0000-0000-0000000006d2'),
  ('00000000-0000-0000-0000-0000000006d3'), ('00000000-0000-0000-0000-0000000006d4'),
  ('00000000-0000-0000-0000-0000000006d5'), ('00000000-0000-0000-0000-0000000006d6'),
  ('00000000-0000-0000-0000-0000000006d7'), ('00000000-0000-0000-0000-0000000006d8'),
  ('00000000-0000-0000-0000-0000000006d9'), ('00000000-0000-0000-0000-0000000006da');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000006c1','Onix','STM0A01','flex',10.0,'company'),
  ('00000000-0000-0000-0000-0000000006c2','HB20','STM0B02','flex',12.5,'own');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-0000000006d1','driver','stm-1',9601,'D1','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001007','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006d2','driver','stm-2',9602,'D2','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001180','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006d3','driver','stm-3',9603,'D3','own_car',null,30,'00000000-0000-0000-0000-0000000006c2',true,'20000001260','2026-03-01'),
  ('00000000-0000-0000-0000-0000000006d4','driver','stm-4',9604,'D4','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001341','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006d5','driver','stm-5',9605,'D5','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001422','2026-03-01'),
  ('00000000-0000-0000-0000-0000000006d6','driver','stm-6',9606,'D6','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001503','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006d7','driver','stm-7',9607,'D7','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001694','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006d8','driver','stm-8',9608,'D8','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001775','2026-06-01'),
  ('00000000-0000-0000-0000-0000000006d9','driver','stm-9',9609,'D9','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000001856','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006da','driver','stm-a',9610,'DA','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',false,'20000001937','2026-04-01');

-- Quinzenas (alinhadas ao ciclo de cada motorista)
insert into driver_periods (id, driver_id, start_date, end_date) values
  ('00000000-0000-0000-0000-000000006e11','00000000-0000-0000-0000-0000000006d1','2026-04-01','2026-04-15'),
  ('00000000-0000-0000-0000-000000006e21','00000000-0000-0000-0000-0000000006d2','2026-04-01','2026-04-15'),
  ('00000000-0000-0000-0000-000000006e31','00000000-0000-0000-0000-0000000006d3','2026-03-01','2026-03-15'),
  ('00000000-0000-0000-0000-000000006e32','00000000-0000-0000-0000-0000000006d3','2026-04-30','2026-05-14'),
  ('00000000-0000-0000-0000-000000006e41','00000000-0000-0000-0000-0000000006d4','2026-04-01','2026-04-15'),
  ('00000000-0000-0000-0000-000000006e51','00000000-0000-0000-0000-0000000006d5','2026-03-01','2026-03-15'),
  ('00000000-0000-0000-0000-000000006e52','00000000-0000-0000-0000-0000000006d5','2026-04-30','2026-05-14'),
  ('00000000-0000-0000-0000-000000006e61','00000000-0000-0000-0000-0000000006d6','2026-04-01','2026-04-15'),
  ('00000000-0000-0000-0000-000000006e71','00000000-0000-0000-0000-0000000006d7','2026-04-01','2026-04-15'),
  ('00000000-0000-0000-0000-000000006e81','00000000-0000-0000-0000-0000000006d8','2026-06-01','2026-06-15'),
  ('00000000-0000-0000-0000-000000006e82','00000000-0000-0000-0000-0000000006d8','2026-06-16','2026-06-30'),
  ('00000000-0000-0000-0000-000000006ea1','00000000-0000-0000-0000-0000000006da','2026-04-01','2026-04-15');

-- Turnos abertos (corridas Uber/BlaBlaCar exigem turno aberto); encerrados depois
insert into shifts (id, driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000006b1','00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006c1','2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b2','00000000-0000-0000-0000-0000000006d2','00000000-0000-0000-0000-0000000006c1','2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b4','00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-0000000006c1','2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b6','00000000-0000-0000-0000-0000000006d6','00000000-0000-0000-0000-0000000006c1','2026-04-05',1000),
  ('00000000-0000-0000-0000-0000000006b8','00000000-0000-0000-0000-0000000006d8','00000000-0000-0000-0000-0000000006c1','2026-06-15',1000);

-- ===== d1: cenário completo carro da empresa (turno 1000→1200, serviço 180, por fora 20) =====
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006d1','uber','2026-04-05',100,50),
  ('00000000-0000-0000-0000-0000000006d1','uber','2026-04-05',50,30),
  ('00000000-0000-0000-0000-0000000006d1','blablacar','2026-04-05',80,70);
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006a1','00000000-0000-0000-0000-0000000006d1',
   'transfer','2026-04-05',300,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006c1','2026-04-05','gasolina',100,16,6.25,'x','approved'),
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006c1','2026-04-06','gasolina',50,8,6.25,'x','pending');
insert into ride_expenses (ride_id, kind, amount, photo_path, review_status, reject_reason) values
  ('00000000-0000-0000-0000-0000000006a1','toll',15.50,'x','approved',null),
  ('00000000-0000-0000-0000-0000000006a1','parking',20.00,'x','rejected','sem nota');
insert into adjustments (driver_id, driver_period_id, kind, amount, description, effective_date) values
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11','advance',-50,'vale','2026-04-05'),
  ('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11','bonus',10,'bônus','2026-04-05');
-- o motorista inicia (liga shift_id) e conclui o transfer com o turno aberto (km 30); depois o turno encerra
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d1","role":"authenticated"}';
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000006a1', 1000, 'a.jpg')$$, 'd1 inicia transfer no turno');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a1', 1030, 'b.jpg')$$, 'd1 conclui transfer no turno');
reset role;
update shifts set ended_at = '2026-04-05 20:00-03', odometer_end = 1200
  where id = '00000000-0000-0000-0000-0000000006b1';

-- ===== d2: mudança de % no meio da quinzena =====
insert into rides (driver_id, platform, ride_date, amount) values
  ('00000000-0000-0000-0000-0000000006d2','uber','2026-04-05',100);
update profiles set uber_pct = 50 where id = '00000000-0000-0000-0000-0000000006d2';
insert into rides (driver_id, platform, ride_date, amount) values
  ('00000000-0000-0000-0000-0000000006d2','uber','2026-04-10',100);

-- ===== d3: carro próprio (Transfer de 50 km) =====
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006d3','transfer','2026-05-05',200,50,'Cli','completed');

-- ===== d4: km negativo =====
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006d4','blablacar','2026-04-05',50,120);
update shifts set ended_at = '2026-04-05 20:00-03', odometer_end = 1100
  where id = '00000000-0000-0000-0000-0000000006b4';

-- ===== d5: sem abastecimento próprio (20 km por fora): com reserva (maio) e sem nota alguma (março) =====
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-0000000006c1','2026-05-05',1000,'2026-05-05 20:00-03',1020),
  ('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-0000000006c1','2026-03-05',1000,'2026-03-05 20:00-03',1020);

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

-- ===== d9: end_shift com estimativa (abastecimento aprovado hoje: 60,00 / 10 L × 10 = 100 km → 0,60) =====
insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_start_photo) values
  ('00000000-0000-0000-0000-0000000006b9','00000000-0000-0000-0000-0000000006d9','00000000-0000-0000-0000-0000000006c1',
   (now() at time zone 'America/Sao_Paulo')::date,1000,'p.jpg');
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006a9','00000000-0000-0000-0000-0000000006d9','transfer',
   (now() at time zone 'America/Sao_Paulo')::date,100,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000006d9','00000000-0000-0000-0000-0000000006c1',
   (now() at time zone 'America/Sao_Paulo')::date,'gasolina',60,10,6,'x','approved');

-- ===== Privilégios =====
select ok(not has_function_privilege('anon', 'compute_statement(uuid,uuid)', 'execute'), 'anon não executa compute_statement');
select ok(has_function_privilege('authenticated', 'compute_statement(uuid,uuid)', 'execute'), 'authenticated executa compute_statement');
select ok(not has_function_privilege('authenticated', 'cost_per_km_for(uuid,uuid)', 'execute'), 'cost_per_km_for é interno');
select ok(not has_function_privilege('anon', 'cost_per_km_for(uuid,uuid)', 'execute'), 'anon não executa cost_per_km_for');

select is((select shift_id from rides where id = '00000000-0000-0000-0000-0000000006a1'),
  '00000000-0000-0000-0000-0000000006b1'::uuid, 'transfer da empresa ligado ao turno aberto');

-- ===== Cenário completo (como admin) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';

create temp table st1 as
  select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11') as j;
select is((select (j->>'uber_share')::numeric from st1), 60.00, 'completo: uber_share');
select is((select (j->>'transfer_share')::numeric from st1), 90.00, 'completo: transfer_share');
select is((select (j->>'fuel_reimbursement')::numeric from st1), 100.00, 'completo: fuel_reimbursement');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from st1), 0::numeric, 'completo: transfer_fuel_reimbursement');
select is((select (j->>'expense_reimbursement')::numeric from st1), 15.50, 'completo: expense_reimbursement (recusada fora)');
select is((select (j->>'cost_per_km')::numeric from st1), 0.625, 'completo: cost_per_km');
select is((select (j->>'off_duty_fuel_discount')::numeric from st1), 12.50, 'completo: off_duty_fuel_discount (20 km × 0,625)');
select is((select (j->>'adjustments')::numeric from st1), -40.00, 'completo: adjustments');
select is((select (j->>'total')::numeric from st1), 213.00, 'completo: total');
select is((select (j->'pending'->>'fuelings')::numeric from st1), 50.00, 'completo: pending.fuelings');
select is((select (j->'pending'->>'expenses')::numeric from st1), 0::numeric, 'completo: pending.expenses');
select is((select j->'km' from st1), '{"total":200,"service":180,"off":20}'::jsonb, 'completo: km');
select is((select (j->>'missing_fuel_price')::boolean from st1), false, 'completo: nota presente');
select is((select (j->>'missing_consumption')::boolean from st1), false, 'completo: consumo presente');
select is((select jsonb_typeof(j->'total') from st1), 'number', 'valores são números');
select is(
  (select array(select jsonb_object_keys(j) order by 1) from st1),
  array['adjustments','cost_per_km','expense_reimbursement','fuel_reimbursement','km',
        'missing_consumption','missing_fuel_price','off_duty_fuel_discount','pending','total',
        'transfer_fuel_reimbursement','transfer_share','uber_share'],
  'formato do extrato');

-- ===== Mudança de % =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d2','00000000-0000-0000-0000-000000006e21')->>'uber_share')::numeric,
  90.00, '% muda no meio da quinzena: uber_share');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d2','00000000-0000-0000-0000-000000006e21')->'km'),
  '{"total":0,"service":0,"off":0}'::jsonb, 'turno aberto não conta km');

-- ===== Carro próprio (reserva: última nota da empresa, 0,625/km) =====
create temp table st3 as
  select compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e32') as j;
select is((select (j->>'transfer_share')::numeric from st3), 60.00, 'carro próprio: transfer_share');
select is((select (j->>'transfer_fuel_reimbursement')::numeric from st3), 31.25, 'carro próprio: transfer_fuel_reimbursement (50 km × 0,625)');
select is((select (j->>'fuel_reimbursement')::numeric from st3), 0::numeric, 'carro próprio: sem reembolso de abastecimento');
select is((select (j->>'off_duty_fuel_discount')::numeric from st3), 0::numeric, 'carro próprio: off_duty_fuel_discount');
select is((select (j->>'total')::numeric from st3), 91.25, 'carro próprio: total');
select is((select (j->>'missing_fuel_price')::boolean from st3), false, 'carro próprio: preço pela reserva');
-- carro próprio sem nota aprovada alguma até o fim da quinzena (março)
reset role;
update rides set ride_date = '2026-03-05' where driver_id = '00000000-0000-0000-0000-0000000006d3';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e31')->>'missing_fuel_price')::boolean,
  true, 'carro próprio sem nota: flag');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e31')->>'transfer_fuel_reimbursement')::numeric,
  0::numeric, 'carro próprio sem nota: reembolso 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d3','00000000-0000-0000-0000-000000006e31')->>'missing_consumption')::boolean,
  false, 'carro próprio sem nota: não é falta de consumo');

-- ===== km negativo =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-000000006e41')->>'off_duty_fuel_discount')::numeric,
  0::numeric, 'km negativo: desconto 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-000000006e41')->'km'),
  '{"total":100,"service":120,"off":0}'::jsonb, 'km negativo: off 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d4','00000000-0000-0000-0000-000000006e41')->>'missing_fuel_price')::boolean,
  false, 'km negativo: sem km por fora não exige nota');

-- ===== Sem abastecimento próprio =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e52')->>'off_duty_fuel_discount')::numeric,
  12.50, 'sem abastecimento: usa a última nota da empresa');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e52')->>'cost_per_km')::numeric,
  0.625, 'sem abastecimento: cost_per_km da reserva');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e52')->>'total')::numeric,
  -12.50, 'sem abastecimento: total negativo');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e51')->>'missing_fuel_price')::boolean,
  true, 'sem nota alguma: flag');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e51')->>'off_duty_fuel_discount')::numeric,
  0::numeric, 'sem nota alguma: desconto 0');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e51')->'cost_per_km'),
  'null'::jsonb, 'sem nota alguma: cost_per_km nulo');

-- ===== Arredondamento =====
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d6','00000000-0000-0000-0000-000000006e61')->>'uber_share')::numeric,
  40.00, 'arredonda depois de somar');

-- ===== Transfer assigned =====
create temp table st7 as
  select compute_statement('00000000-0000-0000-0000-0000000006d7','00000000-0000-0000-0000-000000006e71') as j;
select is((select (j->>'transfer_share')::numeric from st7), 0::numeric, 'assigned: transfer_share 0');
select is((select (j->>'expense_reimbursement')::numeric from st7), 0::numeric, 'assigned: despesa não entra');
select is((select (j->'pending'->>'expenses')::numeric from st7), 0::numeric, 'assigned: pendente não entra');
select is((select (j->>'total')::numeric from st7), 0::numeric, 'assigned: total 0');
-- concluído passa a contar (e a despesa pendente aparece em pending); carro da empresa: sem gasolina de Transfer
reset role;
update rides set transfer_status = 'completed' where id = '00000000-0000-0000-0000-0000000006a7';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d7','00000000-0000-0000-0000-000000006e71')->>'total')::numeric,
  162.00, 'completed: 150 + despesa 12');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d7','00000000-0000-0000-0000-000000006e71')->'pending'->>'expenses')::numeric,
  8.00, 'completed: despesa pendente em pending');

-- ===== Turno noturno 15→16 =====
create temp table st8a as
  select compute_statement('00000000-0000-0000-0000-0000000006d8','00000000-0000-0000-0000-000000006e81') as j;
create temp table st8b as
  select compute_statement('00000000-0000-0000-0000-0000000006d8','00000000-0000-0000-0000-000000006e82') as j;
select is((select j->'km' from st8a), '{"total":100,"service":30,"off":70}'::jsonb, 'noturno: km na quinzena do início');
select is((select (j->>'off_duty_fuel_discount')::numeric from st8a), 43.75, 'noturno: desconto na quinzena 1–15 (70 × 0,625)');
select is((select (j->>'uber_share')::numeric from st8a), 0::numeric, 'noturno: Uber não entra em 1–15');
select is((select (j->>'uber_share')::numeric from st8b), 40.00, 'noturno: Uber entra em 16–fim');
select is((select j->'km' from st8b), '{"total":0,"service":0,"off":0}'::jsonb, 'noturno: km não entra em 16–fim');
select is((select (j->>'off_duty_fuel_discount')::numeric from st8b), 0::numeric, 'noturno: sem desconto em 16–fim');

-- ===== Acesso =====
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-0000000006ff')$$,
  'P0001', 'NOT_FOUND', 'quinzena inexistente');
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e21')$$,
  'P0001', 'NOT_FOUND', 'quinzena de outro motorista');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d1","role":"authenticated"}';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11')->>'total')::numeric,
  213.00, 'motorista calcula o próprio extrato');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d2","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11')$$,
  'P0001', 'FORBIDDEN', 'motorista B não calcula o extrato de A');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006da","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select compute_statement('00000000-0000-0000-0000-0000000006da','00000000-0000-0000-0000-000000006ea1')$$,
  'P0001', 'FORBIDDEN', 'motorista inativo não calcula');
select throws_ok(
  $$select cost_per_km_for('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11')$$,
  '42501', null, 'cost_per_km_for negado a authenticated');
reset role;

-- ===== cost_per_km_for (como postgres) =====
select is(cost_per_km_for('00000000-0000-0000-0000-0000000006d1','00000000-0000-0000-0000-000000006e11')->>'source', 'period', 'cost_per_km_for: notas da quinzena');
select is(cost_per_km_for('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e52')->>'source', 'company_last', 'cost_per_km_for: reserva da empresa');
select is(cost_per_km_for('00000000-0000-0000-0000-0000000006d5','00000000-0000-0000-0000-000000006e51'),
  '{"cost_per_km":null,"source":null,"missing_consumption":false}'::jsonb, 'cost_per_km_for: nulo');

-- ===== end_shift com estimativa (transfer de 5 km conta como serviço) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d9","role":"authenticated"}';
set local role authenticated;
-- o carro 6c1 é compartilhado pelas fixtures: último odômetro 1200 (turno de d1)
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000006a9', 1200, 'a.jpg')$$, 'd9 inicia transfer no turno');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a9', 1205, 'b.jpg')$$, 'd9 conclui transfer no turno');
select is(
  end_shift('00000000-0000-0000-0000-0000000006b9',1020,'f.jpg',null),
  '{"km_total":20,"km_service":5,"km_off":15,"off_discount_estimate":9.00}'::jsonb,
  'end_shift soma o transfer no km em serviço e estima o desconto (15 × 0,60)');
select is(
  end_shift('00000000-0000-0000-0000-0000000006b9',1500,'z.jpg',null),
  '{"km_total":20,"km_service":5,"km_off":15,"off_discount_estimate":9.00}'::jsonb,
  'end_shift repetido mantém a estimativa');
-- turno encerrado: carro da empresa não inicia transfer
reset role;
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006aa','00000000-0000-0000-0000-0000000006d9','transfer','2026-07-01',100,'Cli','assigned'),
  ('00000000-0000-0000-0000-0000000006a3','00000000-0000-0000-0000-0000000006d3','transfer','2026-07-01',100,'Cli','assigned');
set local role authenticated;
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000006aa', 1300, 'a.jpg')$$,
  'P0001', 'NO_OPEN_SHIFT', 'carro da empresa sem turno aberto');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000006aa'), 'assigned', 'falha não inicia');
reset role;
-- carro próprio: inicia e conclui sem turno, shift_id nulo
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d3","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000006a3', 20000, 'a.jpg')$$, 'carro próprio: inicia sem turno');
select is((select shift_id::text from complete_transfer('00000000-0000-0000-0000-0000000006a3', 20010, 'b.jpg')), null, 'carro próprio: shift_id nulo');
reset role;
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000006a3'),
  'completed', 'carro próprio: concluído');

-- ===== reenvio mantém o turno original (6a9 concluído no turno 6b9, já encerrado) =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006a9',false,'km errado')$$, 'admin recusa transfer');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d9","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a9', 1206, 'c.jpg')$$, 'reenvio sem turno aberto funciona');
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
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006a9', 1207, 'd.jpg')$$, 'reenvio com turno novo aberto');
select is((select shift_id::text || '/' || km::text from rides where id = '00000000-0000-0000-0000-0000000006a9'),
  '00000000-0000-0000-0000-0000000006b9/7.0', 'turno novo aberto não reaponta o transfer');
reset role;

-- ===== transfer recusado e reatribuído: km não vaza para o turno do motorista anterior =====
-- db ("João", carro da empresa, turno 6bb) | dc ("Maria", carro da empresa, turno 6bc); quinzena 01/05–15/05
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000006db'), ('00000000-0000-0000-0000-0000000006dc');
insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000006c3','Onix','STM0C03','flex',10.0,'company');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-0000000006db','driver','stm-b',9611,'DB','company_car',40,30,'00000000-0000-0000-0000-0000000006c1',true,'20000002070','2026-04-01'),
  ('00000000-0000-0000-0000-0000000006dc','driver','stm-c',9612,'DC','company_car',40,30,'00000000-0000-0000-0000-0000000006c3',true,'20000002151','2026-04-01');
insert into driver_periods (id, driver_id, start_date, end_date) values
  ('00000000-0000-0000-0000-000000006eb1','00000000-0000-0000-0000-0000000006db','2026-05-01','2026-05-15');
insert into shifts (id, driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000006bb','00000000-0000-0000-0000-0000000006db','00000000-0000-0000-0000-0000000006c1','2026-05-05',1000),
  ('00000000-0000-0000-0000-0000000006bc','00000000-0000-0000-0000-0000000006dc','00000000-0000-0000-0000-0000000006c3','2026-05-05',1000);
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-0000000006db','uber','2026-05-05',100,20);
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000006ab','00000000-0000-0000-0000-0000000006db','transfer','2026-05-05',100,'Cli','assigned'),
  ('00000000-0000-0000-0000-0000000006ac','00000000-0000-0000-0000-0000000006db','transfer','2026-05-05',200,'Cli','assigned');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006db","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000006ab', 1500, 'a.jpg')$$, 'João inicia transfer T');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006ab', 1540, 'b.jpg')$$, 'João conclui transfer T (km 40)');
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000006ac', 1540, 'a.jpg')$$, 'João inicia transfer U');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006ac', 1570, 'b.jpg')$$, 'João conclui transfer U (km 30)');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006ab',false,'errado')$$, 'admin recusa T');
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000006ac',false,'errado')$$, 'admin recusa U (fica in_progress com km 30)');
select lives_ok(
  $$update rides set driver_id = '00000000-0000-0000-0000-0000000006dc' where id = '00000000-0000-0000-0000-0000000006ab'$$,
  'admin reatribui T para Maria');
reset role;
select is((select shift_id from rides where id = '00000000-0000-0000-0000-0000000006ab'), null::uuid,
  'reatribuição solta o turno do João');
-- defesa: shift_id inconsistente (turno de outro motorista) é substituído ao iniciar
update rides set shift_id = '00000000-0000-0000-0000-0000000006bb' where id = '00000000-0000-0000-0000-0000000006ab';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006dc","role":"authenticated"}';
set local role authenticated;
select is((select shift_id from start_transfer('00000000-0000-0000-0000-0000000006ab', 1000, 'a.jpg')),
  '00000000-0000-0000-0000-0000000006bc'::uuid, 'Maria inicia T no próprio turno (turno alheio ignorado)');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000006ab', 1050, 'b.jpg')$$, 'Maria conclui T (km 50)');
reset role;
-- defesa: mesmo com shift_id inconsistente, as somas exigem motorista da corrida = do turno
-- (fixture sem as claims da Maria: senão conta como escrita do motorista fora da RPC)
set local request.jwt.claims = '{}';
update rides set shift_id = '00000000-0000-0000-0000-0000000006bb' where id = '00000000-0000-0000-0000-0000000006ab';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006db","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000006bb',1100,'f.jpg','u.jpg')$$,
  'P0001', 'TRANSFER_IN_PROGRESS', 'turno com Transfer recusado (em andamento) não encerra');
reset role;
-- encerra o turno como fixture; end_shift repetido só recalcula os totais
update shifts set ended_at = now(), odometer_end = 1100 where id = '00000000-0000-0000-0000-0000000006bb';
set local role authenticated;
select is(
  end_shift('00000000-0000-0000-0000-0000000006bb',1100,'f.jpg','u.jpg'),
  '{"km_total":100,"km_service":20,"km_off":80,"off_discount_estimate":50.00}'::jsonb,
  'end_shift do João: só o Uber (sem km da Maria nem do transfer recusado)');
reset role;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006db','00000000-0000-0000-0000-000000006eb1')->'km'),
  '{"total":100,"service":20,"off":80}'::jsonb, 'extrato do João: km em serviço sem T nem U');
select is(
  (compute_statement('00000000-0000-0000-0000-0000000006db','00000000-0000-0000-0000-000000006eb1')->>'off_duty_fuel_discount')::numeric,
  50.00, 'extrato do João: desconto inalterado pelo km da Maria (80 × 0,625)');
reset role;

-- ===== start_shift: odômetro abaixo do último do carro =====
-- turno clássico de d1 encerrou em 1200 no carro 6c1; o maior odômetro do carro agora vem dos Transfers (1570)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d1","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000006bd','00000000-0000-0000-0000-0000000006c1',900,'p.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'start_shift com 900 depois do turno encerrado em 1200');
reset role;

select * from finish();
rollback;
