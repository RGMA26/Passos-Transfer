begin;
select plan(61);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Fixtures próprias (uuids 7xx, seq 97xx). Admin do seed: ad01.
-- Fechamento por motorista (close_driver_period), todos na 1ª quinzena do ciclo:
-- 01 d1 cenário completo | 02 d2 turno só com km por fora | 03 d3 carro próprio (Transfer concluído)
-- 04 turno aberto | 05 Transfer em andamento | 06 abastecimento pendente | 07 sem preço (ciclo 06/2026)
-- 08 turno pendente | 09 turno recusado | 10 despesa pendente (carro próprio)
-- 11..15 motoristas dos alertas (ciclo 03/2026)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000701'), ('00000000-0000-0000-0000-000000000702'),
  ('00000000-0000-0000-0000-000000000703'), ('00000000-0000-0000-0000-000000000704'),
  ('00000000-0000-0000-0000-000000000705'), ('00000000-0000-0000-0000-000000000706'),
  ('00000000-0000-0000-0000-000000000707'), ('00000000-0000-0000-0000-000000000708'),
  ('00000000-0000-0000-0000-000000000709'), ('00000000-0000-0000-0000-000000000710'),
  ('00000000-0000-0000-0000-000000000711'), ('00000000-0000-0000-0000-000000000712'),
  ('00000000-0000-0000-0000-000000000713'), ('00000000-0000-0000-0000-000000000714'),
  ('00000000-0000-0000-0000-000000000715');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000007c1','Onix','CLA0A01','flex',10.0,'company'),
  ('00000000-0000-0000-0000-0000000007c2','HB20','CLA0B02','flex',12.5,'own');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000000701','driver','cla-01',9701,'D1','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000116','2026-07-01'),
  ('00000000-0000-0000-0000-000000000702','driver','cla-02',9702,'D2','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000205','2026-07-01'),
  ('00000000-0000-0000-0000-000000000703','driver','cla-03',9703,'D3','own_car',null,30,'00000000-0000-0000-0000-0000000007c2',true,'30000000388','2026-07-01'),
  ('00000000-0000-0000-0000-000000000704','driver','cla-04',9704,'D4','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000469','2026-07-01'),
  ('00000000-0000-0000-0000-000000000705','driver','cla-05',9705,'D5','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000540','2026-07-01'),
  ('00000000-0000-0000-0000-000000000706','driver','cla-06',9706,'D6','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000620','2026-07-01'),
  ('00000000-0000-0000-0000-000000000707','driver','cla-07',9707,'D7','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000701','2026-06-01'),
  ('00000000-0000-0000-0000-000000000708','driver','cla-08',9708,'D8','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000892','2026-07-01'),
  ('00000000-0000-0000-0000-000000000709','driver','cla-09',9709,'D9','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000000973','2026-07-01'),
  ('00000000-0000-0000-0000-000000000710','driver','cla-10',9710,'D10','own_car',null,30,'00000000-0000-0000-0000-0000000007c2',true,'30000001007','2026-07-01'),
  ('00000000-0000-0000-0000-000000000711','driver','cla-11',9711,'A1','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000001198','2026-03-01'),
  ('00000000-0000-0000-0000-000000000712','driver','cla-12',9712,'A2','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000001279','2026-03-01'),
  ('00000000-0000-0000-0000-000000000713','driver','cla-13',9713,'A3','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000001350','2026-03-01'),
  ('00000000-0000-0000-0000-000000000714','driver','cla-14',9714,'A4','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000001430','2026-03-01'),
  ('00000000-0000-0000-0000-000000000715','driver','cla-15',9715,'A5','company_car',40,30,'00000000-0000-0000-0000-0000000007c1',true,'30000001511','2026-03-01');

-- ===== d1/d2: cenário completo (01/07–15/07), pronto para fechar =====
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
insert into adjustments (driver_id, kind, amount, description, effective_date) values
  ('00000000-0000-0000-0000-000000000701','advance',-50,'vale','2026-07-05'),
  ('00000000-0000-0000-0000-000000000701','bonus',10,'bônus','2026-07-05');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}';
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000007a1', 1000, 'a.jpg')$$, 'd1 inicia transfer no turno');
select lives_ok($$select complete_transfer('00000000-0000-0000-0000-0000000007a1', 1030, 'b.jpg')$$, 'd1 conclui transfer (30 km)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select lives_ok($$select review_item('transfer', '00000000-0000-0000-0000-0000000007a1', true, null)$$, 'admin confere o transfer');
reset role;
set local request.jwt.claims = '{}';
update shifts set ended_at = '2026-07-05 20:00-03', odometer_end = 1200, review_status = 'approved'
  where id = '00000000-0000-0000-0000-0000000007b1';
update shifts set ended_at = '2026-07-06 20:00-03', odometer_end = 1050, review_status = 'approved'
  where id = '00000000-0000-0000-0000-0000000007b2';

-- ===== Quinzenas com erro (uma por motorista) =====
-- d4: turno aberto + transfer assigned + abastecimento pendente (OPEN_SHIFTS vence)
insert into shifts (driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-0000000007c1','2026-07-05',1000);
insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000000704','transfer','2026-07-06',100,'Cli','assigned');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-0000000007c1','2026-07-06','gasolina',50,8,6.250,'x');
-- d5: turno aprovado + transfer em andamento + pendente (ASSIGNED_TRANSFERS vence)
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-000000000705','00000000-0000-0000-0000-0000000007c1','2026-07-05',1000,'2026-07-05 20:00-03',1020,'approved');
insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status, odometer_start, started_at) values
  ('00000000-0000-0000-0000-000000000705','transfer','2026-07-06',100,'Cli','in_progress',1020,'2026-07-06 10:00-03');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000000705','00000000-0000-0000-0000-0000000007c1','2026-07-06','gasolina',50,8,6.250,'x');
-- d6: turno aprovado + abastecimento pendente (PENDING_REVIEW)
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-000000000706','00000000-0000-0000-0000-0000000007c1','2026-07-05',1000,'2026-07-05 20:00-03',1020,'approved');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-000000000706','00000000-0000-0000-0000-0000000007c1','2026-07-06','gasolina',50,8,6.250,'x');
-- d7: 20 km por fora em junho, nenhuma nota aprovada até 15/06 (MISSING_FUEL_PRICE)
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status) values
  ('00000000-0000-0000-0000-000000000707','00000000-0000-0000-0000-0000000007c1','2026-06-05',1000,'2026-06-05 20:00-03',1020,'approved');
-- d3: transfer concluído (carro próprio) ainda sem conferência
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000000703','transfer','2026-07-05',200,50,'Cli','completed');
-- d8: turno encerrado ainda pendente
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end) values
  ('00000000-0000-0000-0000-000000000708','00000000-0000-0000-0000-0000000007c1','2026-07-05',1000,'2026-07-05 20:00-03',1000);
-- d9: turno encerrado recusado
insert into shifts (driver_id, car_id, start_date, odometer_start, ended_at, odometer_end, review_status, reject_reason) values
  ('00000000-0000-0000-0000-000000000709','00000000-0000-0000-0000-0000000007c1','2026-07-05',1000,'2026-07-05 20:00-03',1000,'rejected','km');
-- d10: transfer conferido com despesa pendente
insert into rides (id, driver_id, platform, ride_date, amount, km, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000007a8','00000000-0000-0000-0000-000000000710','transfer','2026-07-05',200,50,'Cli','checked');
insert into ride_expenses (ride_id, kind, amount, photo_path) values
  ('00000000-0000-0000-0000-0000000007a8','toll',9,'x');

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

-- quinzena de cada motorista (já criadas pelos lançamentos)
create temp table pp as
  select driver_id as d, id from driver_periods
   where driver_id::text like '00000000-0000-0000-0000-0000000007%' and start_date in ('2026-07-01', '2026-06-01');
grant select on pp to authenticated;

-- ===== Privilégios =====
select ok(not has_function_privilege('anon', 'close_driver_period(uuid,boolean,boolean)', 'execute'), 'anon não executa close_driver_period');
select ok(not has_function_privilege('anon', 'mark_statement_paid(uuid,date,text)', 'execute'), 'anon não executa mark_statement_paid');
select ok(not has_function_privilege('anon', 'admin_alerts()', 'execute'), 'anon não executa admin_alerts');
select ok(has_function_privilege('authenticated', 'close_driver_period(uuid,boolean,boolean)', 'execute'), 'authenticated executa close_driver_period');
select ok(not has_function_privilege('authenticated', 'resolve_driver_period(uuid,date)', 'execute'), 'resolve_driver_period é interno');

-- ===== Motorista não chama nada =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}';
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000701'))$$, 'P0001', 'FORBIDDEN', 'motorista não fecha quinzena');
select throws_ok($$select mark_statement_paid('00000000-0000-0000-0000-00000000ffff', current_date, 'pix')$$, 'P0001', 'FORBIDDEN', 'motorista não marca pagamento');
select throws_ok($$select * from admin_alerts()$$, 'P0001', 'FORBIDDEN', 'motorista não vê alertas');

-- ===== Admin: erros de fechamento, na ordem =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select close_driver_period('00000000-0000-0000-0000-00000000ffff')$$, 'P0001', 'NOT_FOUND', 'quinzena inexistente');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000704'), true, true)$$, 'P0001', 'OPEN_SHIFTS', 'turno aberto bloqueia (vence assigned e pendente)');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000705'), true, true)$$, 'P0001', 'ASSIGNED_TRANSFERS', 'transfer em andamento bloqueia (vence pendente)');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000706'))$$, 'P0001', 'PENDING_REVIEW', 'abastecimento pendente bloqueia');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000707'))$$, 'P0001', 'MISSING_FUEL_PRICE', 'falta nota de abastecimento');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000703'))$$, 'P0001', 'PENDING_REVIEW', 'transfer concluído sem conferência bloqueia');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000708'))$$, 'P0001', 'PENDING_REVIEW', 'turno pendente bloqueia');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000709'))$$, 'P0001', 'SHIFTS_NOT_APPROVED', 'turno recusado bloqueia');
select throws_ok($$select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000710'))$$, 'P0001', 'PENDING_REVIEW', 'despesa pendente bloqueia');
select is((select status from driver_periods where id = (select id from pp where d = '00000000-0000-0000-0000-000000000704')), 'open', 'falha não fecha a quinzena');

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

-- ===== Caminho feliz =====
create temp table st1 as select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000701')) as id;
select is((select status from driver_periods where id = (select id from pp where d = '00000000-0000-0000-0000-000000000701')), 'closed', 'quinzena de d1 fechada');
select ok((select closed_at is not null from driver_periods where id = (select id from pp where d = '00000000-0000-0000-0000-000000000701')), 'closed_at preenchido');
select is((select missing_fuel_price from driver_periods where id = (select id from pp where d = '00000000-0000-0000-0000-000000000701')), false, 'fechada com nota: sem ❗');
select is((select total from statements where id = (select id from st1)), 213.00::numeric(10,2), 'extrato do d1 com total 213.00');
select is((select (lines->>'total')::numeric from statements where id = (select id from st1)), 213.00, 'lines.total congelado');
select is((select count(*)::int from statements where driver_id <> '00000000-0000-0000-0000-000000000701'
            and driver_id::text like '00000000-0000-0000-0000-0000000007%'), 0, 'fechar d1 não gera extrato de outro');
create temp table st2 as select close_driver_period((select id from pp where d = '00000000-0000-0000-0000-000000000702')) as id;
select is((select total from statements where id = (select id from st2)), 8.75::numeric(10,2), 'extrato do d2: 40 − 31,25 de gasolina por fora (custo da empresa)');

-- ===== Quinzena fechada não aceita mais nada =====
select throws_ok($$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
  values ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-0000000007c1','2026-07-10','gasolina',10,2,5.000,'x')$$,
  'P0001', 'PERIOD_CLOSED', 'insert na quinzena fechada');
select throws_ok($$insert into adjustments (driver_id, kind, amount, description, effective_date)
  values ('00000000-0000-0000-0000-000000000701','bonus',5,'x','2026-07-10')$$,
  'P0001', 'PERIOD_CLOSED', 'ajuste na quinzena fechada');
reset role;
select throws_ok($$update driver_periods set end_date = '2026-07-14' where id = (select id from pp where d = '00000000-0000-0000-0000-000000000701')$$,
  'P0001', 'PERIOD_CLOSED', 'datas congeladas');
select throws_ok($$update driver_periods set status = 'open' where id = (select id from pp where d = '00000000-0000-0000-0000-000000000701')$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada não reabre');
select throws_ok($$delete from driver_periods where id = (select id from pp where d = '00000000-0000-0000-0000-000000000701')$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada não é apagada');

-- ===== Extratos congelados =====
select throws_ok($$update statements set total = 1 where id = (select id from st1)$$,
  'P0001', 'STATEMENT_FROZEN', 'total do extrato congelado');
select throws_ok($$update statements set lines = '{}'::jsonb where id = (select id from st1)$$,
  'P0001', 'STATEMENT_FROZEN', 'lines do extrato congeladas');
select throws_ok($$delete from statements where id = (select id from st1)$$,
  'P0001', 'STATEMENT_FROZEN', 'extrato não é apagado');

-- ===== Pagamento =====
set local role authenticated;
select throws_ok($$select mark_statement_paid((select id from st1), null, 'pix')$$, 'P0001', 'PAYMENT_REQUIRED', 'pagamento sem data');
select throws_ok($$select mark_statement_paid((select id from st1), '2026-07-20', '  ')$$, 'P0001', 'PAYMENT_REQUIRED', 'pagamento sem forma');
select throws_ok($$select mark_statement_paid('00000000-0000-0000-0000-00000000ffff', '2026-07-20', 'pix')$$, 'P0001', 'NOT_FOUND', 'extrato inexistente');
select lives_ok($$select mark_statement_paid((select id from st1), '2026-07-20', 'pix')$$, 'marca como pago');
select is((select paid_at from statements where id = (select id from st1)), '2026-07-20'::date, 'paid_at gravado');
select lives_ok($$select mark_statement_paid((select id from st1), '2026-07-21', 'dinheiro')$$, 'remarcar sobrescreve');
select is((select payment_method from statements where id = (select id from st1)), 'dinheiro', 'payment_method sobrescrito');
select is((select total from statements where id = (select id from st1)), 213.00::numeric(10,2), 'total segue intacto após pagamento');

-- ===== Alertas depois do fechamento =====
select is((select count(*)::int from admin_alerts() where driver_id = '00000000-0000-0000-0000-000000000702'), 0, 'turno de quinzena fechada some dos alertas');
select is((select count(*)::int from admin_alerts() where driver_id = '00000000-0000-0000-0000-000000000711'), 1, 'alertas de quinzena aberta seguem');
reset role;

-- ===== Corrida com close_driver_period: helper trava a quinzena (FOR SHARE) =====
select ok(pg_get_functiondef('row_in_closed_period(text,jsonb)'::regprocedure) ilike '%for share%',
  'row_in_closed_period lê a quinzena com FOR SHARE');
select ok(pg_get_functiondef('close_driver_period(uuid,boolean,boolean)'::regprocedure) ilike '%for update%',
  'close_driver_period trava a quinzena com FOR UPDATE');
select is((select provolatile::text from pg_proc where oid = 'row_in_closed_period(text,jsonb)'::regprocedure), 'v',
  'row_in_closed_period é volatile (exigência do FOR SHARE)');

select * from finish();
rollback;
