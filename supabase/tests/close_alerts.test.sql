-- SKIP TEMPORÁRIO (0010): depende de periods/close_period/period_summary, removidos na 0010.
-- Task 3 reescreve este arquivo sobre driver_periods. O conteúdo original segue abaixo, comentado.
begin;
select plan(1);
select skip('close_alerts.test.sql: aguardando Task 3 (quinzenas por motorista)', 1);
select * from finish();
rollback;

/* ===== ORIGINAL (desativado) =====
begin;
select plan(72);

-- Fixtures próprias (uuids 7xx, seq 97xx). Admin do seed: ad01.
-- 01 d1 cenário completo | 02 d2 turno só com km por fora | 03 d3 carro próprio
-- 04..08 motoristas das quinzenas com erro | 11..15 motoristas dos alertas
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000701'), ('00000000-0000-0000-0000-000000000702'),
  ('00000000-0000-0000-0000-000000000703'), ('00000000-0000-0000-0000-000000000704'),
  ('00000000-0000-0000-0000-000000000705'), ('00000000-0000-0000-0000-000000000706'),
  ('00000000-0000-0000-0000-000000000707'), ('00000000-0000-0000-0000-000000000708'),
  ('00000000-0000-0000-0000-000000000711'), ('00000000-0000-0000-0000-000000000712'),
  ('00000000-0000-0000-0000-000000000713'), ('00000000-0000-0000-0000-000000000714'),
  ('00000000-0000-0000-0000-000000000715');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000007c1','Onix','CLA0A01','flex',10.0,'company'),
  ('00000000-0000-0000-0000-0000000007c2','HB20','CLA0B02','flex',12.5,'own');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active) values
  ('00000000-0000-0000-0000-000000000701','driver','cla-01',9701,'D1','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000702','driver','cla-02',9702,'D2','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000703','driver','cla-03',9703,'D3','own_car',null,30,'00000000-0000-0000-0000-0000000007c2',true),
  ('00000000-0000-0000-0000-000000000704','driver','cla-04',9704,'D4','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000705','driver','cla-05',9705,'D5','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000706','driver','cla-06',9706,'D6','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000707','driver','cla-07',9707,'D7','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000708','driver','cla-08',9708,'D8','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000711','driver','cla-11',9711,'A1','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000712','driver','cla-12',9712,'A2','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000713','driver','cla-13',9713,'A3','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000714','driver','cla-14',9714,'A4','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true),
  ('00000000-0000-0000-0000-000000000715','driver','cla-15',9715,'A5','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true);

insert into periods (id, start_date, end_date, reference_fuel_price) values
  ('00000000-0000-0000-0000-000000007e01','2026-07-01','2026-07-15',6.00),
  ('00000000-0000-0000-0000-000000007e02','2026-08-01','2026-08-15',null),
  ('00000000-0000-0000-0000-000000007e03','2026-08-16','2026-08-31',null),
  ('00000000-0000-0000-0000-000000007e04','2026-09-01','2026-09-15',null),
  ('00000000-0000-0000-0000-000000007e05','2026-09-16','2026-09-30',null),
  ('00000000-0000-0000-0000-000000007e06','2026-10-01','2026-10-15',6.00),
  ('00000000-0000-0000-0000-000000007e07','2026-11-01','2026-11-15',6.00),
  ('00000000-0000-0000-0000-000000007e08','2026-11-16','2026-11-30',6.00),
  ('00000000-0000-0000-0000-000000007e09','2026-12-01','2026-12-15',6.00);

-- ===== Quinzena 1 (julho): cenário completo da Task 6, pronto para fechar =====
insert into shifts (id, driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000007b1','00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000007c1','2026-07-05',1000),
  ('00000000-0000-0000-0000-0000000007b2','00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-0000000007c1','2026-07-06',1000);
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-000000000701','uber','2026-07-05',100,50),
  ('00000000-0000-0000-0000-000000000701','uber','2026-07-05',50,30),
  ('00000000-0000-0000-0000-000000000701','blablacar','2026-07-05',80,70),
  ('00000000-0000-0000-0000-000000000702','uber','2026-07-06',100,null);
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000007a1','00000000-0000-0000-0000-000000000701',
   'transfer','2026-07-05',300,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000007c1','2026-07-05','gasolina',100,16,6.250,'x','approved'),
  ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000007c1','2026-07-06','gasolina',50,8,6.250,'x','rejected');
insert into ride_expenses (ride_id, kind, amount, photo_path, review_status) values
  ('00000000-0000-0000-0000-0000000007a1','toll',15.50,'x','approved'),
  ('00000000-0000-0000-0000-0000000007a1','parking',20.00,'x','rejected');
insert into adjustments (driver_id, period_id, kind, amount, description) values
  ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000007e01','advance',-50,'vale'),
  ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000007e01','bonus',10,'bônus');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}';
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000007a1', 30)$$, 'd1 conclui transfer no turno');
reset role;
set local request.jwt.claims = '{}';
update shifts set ended_at = '2026-07-05 20:00-03', odometer_end = 1200, review_status = 'approved'
  where id = '00000000-0000-0000-0000-0000000007b1';
update shifts set ended_at = '2026-07-06 20:00-03', odometer_end = 1050, review_status = 'approved'
  where id = '00000000-0000-0000-0000-0000000007b2';

update rides set transfer_status = 'checked' where id = '00000000-0000-0000-0000-0000000007a1';

-- ===== Quinzenas com erro =====
-- p2: turno aberto + transfer assigned + abastecimento pendente (OPEN_SHIFTS vence)
insert into shifts (driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-0000000007c1','2026-08-05',1000);
insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000000704','transfer','2026-08-06',100,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-0000000007c1','2026-08-06','gasolina',50,8,6.250,'x');
-- p3: turno encerrado aprovado (20 km por fora, sem preço) + assigned + pendente (ASSIGNED vence)
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-000000000705','00000000-0000-0000-0000-0000000007c1','2026-08-20',1000,'2026-08-20 20:00-03',1020,'approved');
insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000000705','transfer','2026-08-21',100,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000000705','00000000-0000-0000-0000-0000000007c1','2026-08-21','gasolina',50,8,6.250,'x');
-- p4: turno encerrado aprovado (sem preço) + abastecimento pendente (PENDING vence MISSING)
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-000000000706','00000000-0000-0000-0000-0000000007c1','2026-09-05',1000,'2026-09-05 20:00-03',1020,'approved');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000000706','00000000-0000-0000-0000-0000000007c1','2026-09-06','gasolina',50,8,6.250,'x');
-- p5: só falta o preço de referência (20 km por fora, sem abastecimento)
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-000000000707','00000000-0000-0000-0000-0000000007c1','2026-09-20',1000,'2026-09-20 20:00-03',1020,'approved');
-- p6: transfer concluído (carro próprio) ainda sem conferência
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000000703','transfer','2026-10-05',200,50,'Cli','completed');
-- p7: turno encerrado ainda pendente
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-000000000708','00000000-0000-0000-0000-0000000007c1','2026-11-05',1000,'2026-11-05 20:00-03',1000);
-- p8: transfer conferido com despesa pendente
insert into rides (id, driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000007a8','00000000-0000-0000-0000-000000000703','transfer','2026-11-20',200,50,'Cli','checked');
insert into ride_expenses (ride_id, kind, amount, photo_path) values
  ('00000000-0000-0000-0000-0000000007a8','toll',9,'x');
-- p9: vazia

-- ===== Alertas (turnos em março, sem quinzena fechada) =====
insert into shifts (id, driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000007d1','00000000-0000-0000-0000-000000000711','00000000-0000-0000-0000-0000000007c1','2026-03-05',1000),
  ('00000000-0000-0000-0000-0000000007d2','00000000-0000-0000-0000-000000000712','00000000-0000-0000-0000-0000000007c1','2026-03-05',1000),
  ('00000000-0000-0000-0000-0000000007d3','00000000-0000-0000-0000-000000000713','00000000-0000-0000-0000-0000000007c1','2026-03-05',1000);
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-000000000711','blablacar','2026-03-05',10,150),
  ('00000000-0000-0000-0000-000000000712','blablacar','2026-03-05',10,160),
  ('00000000-0000-0000-0000-000000000713','blablacar','2026-03-05',10,120);
update shifts set ended_at = '2026-03-05 20:00-03', odometer_end = 1200
  where id in ('00000000-0000-0000-0000-0000000007d1','00000000-0000-0000-0000-0000000007d2');
update shifts set ended_at = '2026-03-05 20:00-03', odometer_end = 1100
  where id = '00000000-0000-0000-0000-0000000007d3';
insert into shifts (id, driver_id, car_id, start_date, started_at, odometer_start) values
  ('00000000-0000-0000-0000-0000000007d4','00000000-0000-0000-0000-000000000714','00000000-0000-0000-0000-0000000007c1','2026-03-05', now() - interval '25 hours',1000),
  ('00000000-0000-0000-0000-0000000007d5','00000000-0000-0000-0000-000000000715','00000000-0000-0000-0000-0000000007c1','2026-03-05', now() - interval '2 hours',1000);

-- ===== Privilégios =====
select ok(not has_function_privilege('anon', 'close_period(uuid,boolean)', 'execute'), 'anon não executa close_period');
select ok(not has_function_privilege('anon', 'mark_statement_paid(uuid,date,text)', 'execute'), 'anon não executa mark_statement_paid');
select ok(not has_function_privilege('anon', 'admin_alerts()', 'execute'), 'anon não executa admin_alerts');
select ok(not has_function_privilege('anon', 'period_summary(uuid)', 'execute'), 'anon não executa period_summary');
select ok(has_function_privilege('authenticated', 'close_period(uuid,boolean)', 'execute'), 'authenticated executa close_period');
select ok(not has_function_privilege('authenticated', 'period_movement_drivers(uuid)', 'execute'), 'period_movement_drivers é interno');

-- ===== Motorista não chama nada =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}';
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e01')$$, 'P0001', 'FORBIDDEN', 'motorista não fecha quinzena');
select throws_ok($$select mark_statement_paid('00000000-0000-0000-0000-000000007e01', current_date, 'pix')$$, 'P0001', 'FORBIDDEN', 'motorista não marca pagamento');
select throws_ok($$select * from admin_alerts()$$, 'P0001', 'FORBIDDEN', 'motorista não vê alertas');
select throws_ok($$select period_summary('00000000-0000-0000-0000-000000007e01')$$, 'P0001', 'FORBIDDEN', 'motorista não vê resumo');

-- ===== Admin: erros de fechamento, na ordem =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select close_period('00000000-0000-0000-0000-00000000ffff')$$, 'P0001', 'NOT_FOUND', 'quinzena inexistente');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e02')$$, 'P0001', 'OPEN_SHIFTS', 'turno aberto bloqueia (vence assigned e pendente)');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e03')$$, 'P0001', 'ASSIGNED_TRANSFERS', 'transfer assigned bloqueia (vence pendente)');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e04')$$, 'P0001', 'PENDING_REVIEW', 'abastecimento pendente bloqueia (vence preço)');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e05')$$, 'P0001', 'MISSING_REFERENCE_PRICE', 'falta preço de referência');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e06')$$, 'P0001', 'PENDING_REVIEW', 'transfer concluído sem conferência bloqueia');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e07', true)$$, 'P0001', 'PENDING_REVIEW', 'turno pendente bloqueia');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e08', true)$$, 'P0001', 'PENDING_REVIEW', 'despesa pendente bloqueia');
select is((select status from periods where id = '00000000-0000-0000-0000-000000007e02'), 'open', 'falha não fecha a quinzena');

-- quinzena fechada com sucesso depois de resolver a pendência: p9 vazia fecha com 0 extratos
select is(close_period('00000000-0000-0000-0000-000000007e09', true), 0, 'quinzena sem movimento fecha com 0 extratos');
select throws_ok($$select close_period('00000000-0000-0000-0000-000000007e09', true)$$, 'P0001', 'ALREADY_CLOSED', 'fechar de novo');

-- ===== Alertas =====
create temp table al as select * from admin_alerts();
select is((select count(*)::int from al where driver_id = '00000000-0000-0000-0000-000000000711' and kind = 'HIGH_OFF_KM'), 1, 'HIGH_OFF_KM: 50 de 200 km por fora');
select is((select detail from al where driver_id = '00000000-0000-0000-0000-000000000711'),
  '{"km_total":200,"km_service":150,"km_off":50}'::jsonb, 'HIGH_OFF_KM: detail');
select is((select count(*)::int from al where driver_id = '00000000-0000-0000-0000-000000000712'), 0, 'exatamente 20% por fora não alerta');
select is((select kind from al where driver_id = '00000000-0000-0000-0000-000000000713'), 'NEGATIVE_OFF_KM', 'NEGATIVE_OFF_KM: 120 km lançados em 100 rodados');
select is((select detail from al where driver_id = '00000000-0000-0000-0000-000000000713'),
  '{"km_total":100,"km_service":120,"km_off":-20}'::jsonb, 'NEGATIVE_OFF_KM: detail');
select is((select kind from al where driver_id = '00000000-0000-0000-0000-000000000714'), 'SHIFT_OPEN_24H', 'SHIFT_OPEN_24H: turno aberto há 25 h');
select ok((select detail ? 'started_at' from al where driver_id = '00000000-0000-0000-0000-000000000714'), 'SHIFT_OPEN_24H: detail traz started_at');
select is((select shift_id from al where driver_id = '00000000-0000-0000-0000-000000000714'),
  '00000000-0000-0000-0000-0000000007d4'::uuid, 'SHIFT_OPEN_24H: shift_id');
select is((select count(*)::int from al where driver_id = '00000000-0000-0000-0000-000000000715'), 0, 'turno aberto há 2 h não alerta');
select is((select count(*)::int from al where driver_id = '00000000-0000-0000-0000-000000000701'), 0, 'turno com km em dia não alerta');
select is((select count(*)::int from al where driver_id = '00000000-0000-0000-0000-000000000702' and kind = 'HIGH_OFF_KM'), 1, 'd2 alerta antes do fechamento (50 de 50 km por fora)');
select is((select array_agg(driver_id) from (select driver_id from admin_alerts() offset 0) x),
  (select array_agg(driver_id order by driver_id) from al), 'alertas saem ordenados por motorista');

-- ===== Resumo da quinzena aberta (calculado na hora) =====
create temp table sum_open as select period_summary('00000000-0000-0000-0000-000000007e01') as j;
select is((select j->'revenue' from sum_open),
  '{"uber":250.00,"transfer":300.00,"blablacar":80.00}'::jsonb, 'resumo: receita por plataforma');
select is((select (j->>'drivers_share')::numeric from sum_open), 190.00, 'resumo: drivers_share = uber_share + transfer_share');
select is((select (j->>'company_share')::numeric from sum_open), 440.00, 'resumo: company_share = receita total - drivers_share');
select is((select (j->>'fuel_reimbursed')::numeric from sum_open), 100.00, 'resumo: fuel_reimbursed');
select is((select (j->>'fuel_discounted')::numeric from sum_open), 42.50, 'resumo: fuel_discounted');
select is((select jsonb_array_length(j->'off_km_ranking') from sum_open), 2, 'resumo: ranking com 2 motoristas');
select is((select j->'off_km_ranking'->0 from sum_open),
  '{"driver_id":"00000000-0000-0000-0000-000000000702","name":"D2","km_off":50}'::jsonb, 'resumo: ranking começa por quem tem mais km por fora');
select is((select (j->'off_km_ranking'->1->>'km_off')::numeric from sum_open), 20::numeric, 'resumo: segundo do ranking');
select throws_ok($$select period_summary('00000000-0000-0000-0000-00000000ffff')$$, 'P0001', 'NOT_FOUND', 'resumo de quinzena inexistente');

-- ===== Caminho feliz =====
select is(close_period('00000000-0000-0000-0000-000000007e01'), 2, 'fecha a quinzena com 2 extratos (d1 e d2)');
select is((select status from periods where id = '00000000-0000-0000-0000-000000007e01'), 'closed', 'quinzena fechada');
select ok((select closed_at is not null from periods where id = '00000000-0000-0000-0000-000000007e01'), 'closed_at preenchido');
select is((select total from statements where driver_id = '00000000-0000-0000-0000-000000000701'
                                          and period_id = '00000000-0000-0000-0000-000000007e01'), 213.00, 'extrato do d1 com total 213.00');
select is((select (lines->>'total')::numeric from statements where driver_id = '00000000-0000-0000-0000-000000000701'
                                          and period_id = '00000000-0000-0000-0000-000000007e01'), 213.00, 'lines.total congelado');
select is((select total from statements where driver_id = '00000000-0000-0000-0000-000000000702'
                                          and period_id = '00000000-0000-0000-0000-000000007e01'), 10.00, 'extrato do d2: 40 - 30 de gasolina por fora');
select is((select count(*)::int from statements where driver_id = '00000000-0000-0000-0000-000000000703'), 0, 'motorista sem movimento não ganha extrato');

-- ===== Quinzena fechada não aceita mais nada =====
select throws_ok($$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
  values ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000007c1','2026-07-10','gasolina',10,2,5.000,'x')$$,
  'P0001', 'PERIOD_CLOSED', 'insert na quinzena fechada');
select throws_ok($$insert into adjustments (driver_id, period_id, kind, amount, description)
  values ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000007e01','bonus',5,'x')$$,
  'P0001', 'PERIOD_CLOSED', 'ajuste na quinzena fechada');
select throws_ok($$update periods set reference_fuel_price = 7 where id = '00000000-0000-0000-0000-000000007e01'$$,
  'P0001', 'PERIOD_CLOSED', 'preço de referência congelado');
select throws_ok($$update periods set status = 'open' where id = '00000000-0000-0000-0000-000000007e01'$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada não reabre');
select throws_ok($$delete from periods where id = '00000000-0000-0000-0000-000000007e01'$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada não é apagada');

-- ===== Extratos congelados =====
select throws_ok($$update statements set total = 1 where driver_id = '00000000-0000-0000-0000-000000000701'$$,
  'P0001', 'STATEMENT_FROZEN', 'total do extrato congelado');
select throws_ok($$update statements set lines = '{}'::jsonb where driver_id = '00000000-0000-0000-0000-000000000701'$$,
  'P0001', 'STATEMENT_FROZEN', 'lines do extrato congeladas');
select throws_ok($$delete from statements where driver_id = '00000000-0000-0000-0000-000000000701'$$,
  'P0001', 'STATEMENT_FROZEN', 'extrato não é apagado');

-- ===== Pagamento =====
create temp table stid as
  select id from statements where driver_id = '00000000-0000-0000-0000-000000000701';
select throws_ok($$select mark_statement_paid((select id from stid), null, 'pix')$$, 'P0001', 'PAYMENT_REQUIRED', 'pagamento sem data');
select throws_ok($$select mark_statement_paid((select id from stid), '2026-07-20', '  ')$$, 'P0001', 'PAYMENT_REQUIRED', 'pagamento sem forma');
select throws_ok($$select mark_statement_paid('00000000-0000-0000-0000-00000000ffff', '2026-07-20', 'pix')$$, 'P0001', 'NOT_FOUND', 'extrato inexistente');
select lives_ok($$select mark_statement_paid((select id from stid), '2026-07-20', 'pix')$$, 'marca como pago');
select is((select paid_at from statements where id = (select id from stid)), '2026-07-20'::date, 'paid_at gravado');
select lives_ok($$select mark_statement_paid((select id from stid), '2026-07-21', 'dinheiro')$$, 'remarcar sobrescreve');
select is((select payment_method from statements where id = (select id from stid)), 'dinheiro', 'payment_method sobrescrito');
select is((select total from statements where id = (select id from stid)), 213.00, 'total segue intacto após pagamento');

-- ===== Resumo congelado e alertas =====
select is((select period_summary('00000000-0000-0000-0000-000000007e01')), (select j from sum_open), 'resumo da quinzena fechada igual ao calculado antes');
select is((select count(*)::int from admin_alerts() where driver_id = '00000000-0000-0000-0000-000000000702'), 0, 'turno de quinzena fechada some dos alertas');
select is((select count(*)::int from admin_alerts() where driver_id = '00000000-0000-0000-0000-000000000711'), 1, 'alertas de quinzena aberta seguem');

-- ===== Corrida com close_period: helper trava a quinzena (FOR SHARE) =====
select ok(pg_get_functiondef('row_in_closed_period(text,jsonb)'::regprocedure) ilike '%for share%',
  'row_in_closed_period lê a quinzena com FOR SHARE');
-- regressão: o select que trava não pode filtrar por status (senão o snapshot antigo pula a linha sem travar)
select ok(pg_get_functiondef('row_in_closed_period(text,jsonb)'::regprocedure) !~* 'status\s*=\s*''closed''\s+(and|for)'
  and pg_get_functiondef('row_in_closed_period(text,jsonb)'::regprocedure) !~* 'and\s+status\s*=\s*''closed''',
  'o select FOR SHARE não filtra por status');
select is((select provolatile::text from pg_proc where oid = 'row_in_closed_period(text,jsonb)'::regprocedure), 'v',
  'row_in_closed_period é volatile (exigência do FOR SHARE)');

select * from finish();
rollback;

===== FIM ORIGINAL ===== */
