begin;
select plan(101);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Fixtures próprias (uuids 4xxx). Admin do seed: ad01.
-- A (4a01), B (4a02): carro próprio, ciclo 01/07 | C (4a03): ciclo hoje−3 (quinzena em andamento)
-- P (4a10): carro próprio, ciclo 10/10 (pausa/retomada) | Q (4a11): carro da empresa, turno aberto
-- S1..S7 (4a21..4a27): sinais com datas relativas a hoje (SP); S7 em estado inconsistente
create temp table td as select (now() at time zone 'America/Sao_Paulo')::date as d;
grant select on td to authenticated;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000004a01'), ('00000000-0000-0000-0000-000000004a02'),
  ('00000000-0000-0000-0000-000000004a03'), ('00000000-0000-0000-0000-000000004a10'),
  ('00000000-0000-0000-0000-000000004a11'), ('00000000-0000-0000-0000-000000004a21'),
  ('00000000-0000-0000-0000-000000004a22'), ('00000000-0000-0000-0000-000000004a23'),
  ('00000000-0000-0000-0000-000000004a24'), ('00000000-0000-0000-0000-000000004a25'),
  ('00000000-0000-0000-0000-000000004a26'), ('00000000-0000-0000-0000-000000004a27');

insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-000000004c01','Onix','DCL0A01','flex',10.0,'company'),
  ('00000000-0000-0000-0000-000000004c02','HB20','DCL0B02','flex',12.5,'own'),
  ('00000000-0000-0000-0000-000000004c03','Gol','DCL0C03','flex',null,'own');

insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000004a01','driver','dcl-01',9401,'A','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000124','2026-07-01'),
  ('00000000-0000-0000-0000-000000004a02','driver','dcl-02',9402,'B','own_car',null,30,'00000000-0000-0000-0000-000000004c03',true,'40000000205','2026-07-01'),
  ('00000000-0000-0000-0000-000000004a03','driver','dcl-03',9403,'C','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000396',(select d from td) - 3),
  ('00000000-0000-0000-0000-000000004a10','driver','dcl-10',9410,'P','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000477','2026-10-10'),
  ('00000000-0000-0000-0000-000000004a11','driver','dcl-11',9411,'Q','company_car',40,30,'00000000-0000-0000-0000-000000004c01',true,'40000000558','2026-11-01'),
  ('00000000-0000-0000-0000-000000004a21','driver','dcl-21',9421,'S1','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000639',(select d from td) - 9),
  ('00000000-0000-0000-0000-000000004a22','driver','dcl-22',9422,'S2','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000710',(select d from td) - 8),
  ('00000000-0000-0000-0000-000000004a23','driver','dcl-23',9423,'S3','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000809',(select d from td) - 15),
  ('00000000-0000-0000-0000-000000004a24','driver','dcl-24',9424,'S4','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000000981',(select d from td) - 9),
  ('00000000-0000-0000-0000-000000004a25','driver','dcl-25',9425,'S5','own_car',null,30,'00000000-0000-0000-0000-000000004c02',false,'40000001015',(select d from td) - 9),
  ('00000000-0000-0000-0000-000000004a26','driver','dcl-26',9426,'S6','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000001104',(select d from td) - 15),
  ('00000000-0000-0000-0000-000000004a27','driver','dcl-27',9427,'S7','own_car',null,30,'00000000-0000-0000-0000-000000004c02',true,'40000001287',(select d from td) - 9);

-- ===== Funções e privilégios =====
select has_function('public', 'close_driver_period', array['uuid','boolean','boolean'], 'close_driver_period existe');
select hasnt_function('public', 'close_period', 'close_period removida');
select has_table('public', 'driver_pauses', 'driver_pauses existe');
select ok(not has_function_privilege('anon', 'close_driver_period(uuid,boolean,boolean)', 'execute'), 'anon não fecha');
select ok(has_function_privilege('authenticated', 'close_driver_period(uuid,boolean,boolean)', 'execute'), 'authenticated chama close_driver_period');
select ok(not has_function_privilege('anon', 'driver_period_signals()', 'execute'), 'anon não vê sinais');
select ok(not has_function_privilege('anon', 'pause_driver(uuid,date,text)', 'execute'), 'anon não pausa');
select ok(not has_function_privilege('anon', 'resume_driver(uuid,date)', 'execute'), 'anon não retoma');

-- ===== Quinzenas de A e B (01/07–15/07, 16/07–30/07) =====
create temp table pa1 as select driver_period_for('00000000-0000-0000-0000-000000004a01', '2026-07-05') as id;
create temp table pa2 as select driver_period_for('00000000-0000-0000-0000-000000004a01', '2026-07-20') as id;
create temp table pb1 as select driver_period_for('00000000-0000-0000-0000-000000004a02', '2026-07-05') as id;
create temp table pc1 as select driver_period_for('00000000-0000-0000-0000-000000004a03', (select d from td)) as id;
grant select on pa1, pa2, pb1, pc1 to authenticated;

-- A: Transfer conferido de 50 km (carro próprio) e nenhuma nota aprovada até 15/07 → falta preço
-- B: Transfer conferido de 40 km e nota aprovada de carro sem consumo → falta consumo
insert into rides (driver_id, platform, ride_date, amount, km, client_name, transfer_status, car_id) values
  ('00000000-0000-0000-0000-000000004a01','transfer','2026-07-05',200,50,'Cli','checked','00000000-0000-0000-0000-000000004c02'),
  ('00000000-0000-0000-0000-000000004a02','transfer','2026-07-05',100,40,'Cli','checked','00000000-0000-0000-0000-000000004c03');
insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000004a02','00000000-0000-0000-0000-000000004c03','2026-07-06','gasolina',60,10,6.000,'x','approved');

-- ===== Motorista não executa nada =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000004a01","role":"authenticated"}';
select throws_ok($$select close_driver_period((select id from pa1))$$, 'P0001', 'FORBIDDEN', 'motorista não fecha a própria quinzena');
select throws_ok($$select * from driver_period_signals()$$, 'P0001', 'FORBIDDEN', 'motorista não vê sinais');
select throws_ok($$select pause_driver(auth.uid(), '2026-11-15', null)$$, 'P0001', 'FORBIDDEN', 'motorista não pausa');
select throws_ok($$select resume_driver(auth.uid(), '2026-12-01')$$, 'P0001', 'FORBIDDEN', 'motorista não retoma');
select throws_ok($$select mark_statement_paid('00000000-0000-0000-0000-00000000ffff', '2026-07-20', 'pix')$$, 'P0001', 'FORBIDDEN', 'motorista não marca pagamento');
select throws_ok($$select * from admin_alerts()$$, 'P0001', 'FORBIDDEN', 'motorista não vê alertas');

-- ===== Fechamento: ordem, isolamento, falta de preço/consumo =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select close_driver_period('00000000-0000-0000-0000-00000000ffff')$$, 'P0001', 'NOT_FOUND', 'quinzena inexistente');
select throws_ok($$select close_driver_period((select id from pa2))$$, 'P0001', 'PREVIOUS_OPEN', '2ª quinzena com a 1ª aberta');
select throws_ok($$select close_driver_period((select id from pa2), true, true)$$, 'P0001', 'PREVIOUS_OPEN', 'PREVIOUS_OPEN vence force/allow');
select throws_ok($$select close_driver_period((select id from pc1))$$, 'P0001', 'PERIOD_NOT_ENDED', 'quinzena em andamento sem force');
select throws_ok($$select close_driver_period((select id from pa1))$$, 'P0001', 'MISSING_FUEL_PRICE', 'sem nota aprovada: pede confirmação');
select throws_ok($$select close_driver_period((select id from pb1))$$, 'P0001', 'MISSING_FUEL_PRICE', 'sem consumo do carro: pede confirmação');
select is((select status from driver_periods where id = (select id from pa1)), 'open', 'falha não fecha');

create temp table sa1 as select close_driver_period((select id from pa1), false, true) as id;
select ok((select id from sa1) is not null, 'fecha com p_allow_missing_fuel_price');
select is((select status from driver_periods where id = (select id from pa1)), 'closed', 'quinzena de A fechada');
select ok((select closed_at is not null from driver_periods where id = (select id from pa1)), 'closed_at preenchido');
select is((select missing_fuel_price from driver_periods where id = (select id from pa1)), true, 'marca ❗ (sem nota)');
select is((select lines->>'missing_fuel_price' from statements where id = (select id from sa1)), 'true', 'extrato congelado com missing_fuel_price');
select is((select driver_period_id from statements where id = (select id from sa1)), (select id from pa1), 'extrato ligado à quinzena');
select is((select total from statements where id = (select id from sa1)), 60.00::numeric(10,2), 'total do extrato de A (30% de 200, gasolina R$ 0)');
select throws_ok($$select close_driver_period((select id from pa1), true, true)$$, 'P0001', 'ALREADY_CLOSED', 'fechar de novo');

-- isolamento: B na mesma data segue aberta e recebe lançamentos
select is((select status from driver_periods where id = (select id from pb1)), 'open', 'fechar A não fecha B');
select is((select count(*)::int from statements where driver_id = '00000000-0000-0000-0000-000000004a02'), 0, 'B sem extrato');
select lives_ok($$insert into adjustments (driver_id, kind, amount, description, effective_date)
  values ('00000000-0000-0000-0000-000000004a02','bonus',5,'x','2026-07-10')$$, 'B ainda recebe ajuste em 10/07');
select throws_ok($$insert into adjustments (driver_id, kind, amount, description, effective_date)
  values ('00000000-0000-0000-0000-000000004a01','bonus',5,'x','2026-07-10')$$, 'P0001', 'PERIOD_CLOSED', 'A não recebe mais');

create temp table sb1 as select close_driver_period((select id from pb1), false, true) as id;
select is((select missing_fuel_price from driver_periods where id = (select id from pb1)), true, 'marca ❗ também sem consumo');
select is((select lines->>'missing_consumption' from statements where id = (select id from sb1)), 'true', 'extrato de B com missing_consumption');
select is((select total from statements where id = (select id from sb1)), 35.00::numeric(10,2), 'B: 30% de 100 + 5 de ajuste');

-- 2ª quinzena de A agora fecha (vazia): um extrato zerado
create temp table sa2 as select close_driver_period((select id from pa2)) as id;
select is((select total from statements where id = (select id from sa2)), 0.00::numeric(10,2), 'quinzena vazia gera extrato zerado');

-- force fecha a quinzena em andamento
create temp table sc1 as select close_driver_period((select id from pc1), true) as id;
select is((select status from driver_periods where id = (select id from pc1)), 'closed', 'force fecha quinzena em andamento');

-- pagamento
select lives_ok($$select mark_statement_paid((select id from sa1), '2026-07-20', 'pix')$$, 'marca pago');
select is((select paid_at from statements where id = (select id from sa1)), '2026-07-20'::date, 'paid_at gravado');
reset role;

-- ===== Pausa e retomada =====
create temp table pp1 as select driver_period_for('00000000-0000-0000-0000-000000004a10', '2026-10-12') as id;
grant select on pp1 to authenticated;
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000004b01','00000000-0000-0000-0000-000000004a10','transfer','2026-10-12',100,'T1','assigned'),
  ('00000000-0000-0000-0000-000000004b02','00000000-0000-0000-0000-000000004a10','transfer','2026-10-12',100,'T2','assigned'),
  ('00000000-0000-0000-0000-000000004b03','00000000-0000-0000-0000-000000004a01','transfer','2026-10-12',100,'T3','assigned'),
  ('00000000-0000-0000-0000-000000004b04','00000000-0000-0000-0000-000000004a10','transfer','2026-10-20',100,'T4','assigned');
insert into shifts (driver_id, car_id, start_date, odometer_start) values
  ('00000000-0000-0000-0000-000000004a11','00000000-0000-0000-0000-000000004c01','2026-11-02',1000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000004a10","role":"authenticated"}';
select lives_ok($$select start_transfer('00000000-0000-0000-0000-000000004b02', 5000, 'a.jpg')$$, 'P inicia T2 antes da pausa');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select pause_driver('00000000-0000-0000-0000-000000004a10', '2026-10-15', 'Férias')$$,
  'P0001', 'ENTRIES_AFTER_PAUSE', 'lançamento depois da data da pausa impede pausar');
select throws_ok($$select pause_driver('00000000-0000-0000-0000-000000004a11', (select d from td), null)$$,
  'P0001', 'OPEN_SHIFTS', 'turno aberto impede pausar');
select throws_ok($$select pause_driver('00000000-0000-0000-0000-00000000ffff', '2026-10-15', null)$$,
  'P0001', 'NOT_FOUND', 'motorista inexistente');
select lives_ok($$delete from rides where id = '00000000-0000-0000-0000-000000004b04'$$, 'admin remove T4');
select lives_ok($$select pause_driver('00000000-0000-0000-0000-000000004a10', '2026-10-15', 'Férias')$$, 'pausa em 15/10');
select results_eq($$select start_date, end_date from driver_periods where id = (select id from pp1)$$,
  $$values ('2026-10-10'::date, '2026-10-15'::date)$$, 'quinzena 10/10–24/10 encurtada até 15/10');
select is((select paused from profiles where id = '00000000-0000-0000-0000-000000004a10'), true, 'perfil pausado');
select results_eq($$select paused_on, resumed_on, reason from driver_pauses where driver_id = '00000000-0000-0000-0000-000000004a10'$$,
  $$values ('2026-10-15'::date, null::date, 'Férias'::text)$$, 'histórico da pausa');
select throws_ok($$select pause_driver('00000000-0000-0000-0000-000000004a10', '2026-10-16', null)$$,
  'P0001', 'ALREADY_PAUSED', 'pausar de novo');
select throws_ok($$select pause_driver('00000000-0000-0000-0000-000000004a01', (select d from td) + 1, null)$$,
  'P0001', 'INVALID_DATE', 'pausa com data futura');
select throws_ok($$update profiles set paused = false where id = '00000000-0000-0000-0000-000000004a10'$$,
  'P0001', 'PAUSED_LOCKED', 'admin não tira a pausa direto');
select throws_ok($$update profiles set paused = true where id = '00000000-0000-0000-0000-000000004a01'$$,
  'P0001', 'PAUSED_LOCKED', 'admin não pausa direto');

-- admin: nunca bloqueado pela pausa, mas não atribui Transfer a pausado
select lives_ok($$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
  values ('00000000-0000-0000-0000-000000004a10','00000000-0000-0000-0000-000000004c02','2026-10-14','gasolina',60,10,6.000,'x')$$,
  'admin lança para o pausado dentro da quinzena');
select throws_ok($$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status)
  values ('00000000-0000-0000-0000-000000004a10','transfer','2026-10-14',100,'T5','assigned')$$,
  'P0001', 'DRIVER_PAUSED', 'não atribui Transfer novo a pausado');
select throws_ok($$update rides set driver_id = '00000000-0000-0000-0000-000000004a10' where id = '00000000-0000-0000-0000-000000004b03'$$,
  'P0001', 'DRIVER_PAUSED', 'não reatribui Transfer a pausado');
select lives_ok($$update rides set amount = 120 where id = '00000000-0000-0000-0000-000000004b01'$$,
  'admin edita Transfer já atribuído ao pausado');

-- motorista pausado
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000004a10","role":"authenticated"}';
select throws_ok($$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
  values (auth.uid(),'00000000-0000-0000-0000-000000004c02','2026-10-16','gasolina',60,10,6.000,'x')$$,
  'P0001', 'DRIVER_PAUSED', 'lançamento em 16/10 (depois da pausa)');
select lives_ok($$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
  values (auth.uid(),'00000000-0000-0000-0000-000000004c02','2026-10-15','gasolina',60,10,6.000,'x')$$,
  'lançamento em 15/10 (offline, último dia) entra');
select throws_ok($$select start_transfer('00000000-0000-0000-0000-000000004b01', 5100, 'a.jpg')$$,
  'P0001', 'DRIVER_PAUSED', 'pausado não inicia Transfer');
select throws_ok($$select complete_transfer('00000000-0000-0000-0000-000000004b02', 5100, 'b.jpg')$$,
  'P0001', 'DRIVER_PAUSED', 'pausado não conclui Transfer');
select throws_ok($$select start_shift(null, '00000000-0000-0000-0000-000000004c01', 9999, 'a.jpg')$$,
  'P0001', 'DRIVER_PAUSED', 'pausado não inicia turno');

-- retomada
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$select resume_driver('00000000-0000-0000-0000-000000004a10', '2026-10-15')$$,
  'P0001', 'INVALID_DATE', 'retomar no dia da pausa');
select throws_ok($$select resume_driver('00000000-0000-0000-0000-000000004a10', '2026-10-01')$$,
  'P0001', 'INVALID_DATE', 'retomar antes da pausa');
select throws_ok($$select resume_driver('00000000-0000-0000-0000-000000004a10', null)$$,
  'P0001', 'INVALID_DATE', 'retomar sem data');
select throws_ok($$select resume_driver('00000000-0000-0000-0000-000000004a01', '2026-11-01')$$,
  'P0001', 'NOT_PAUSED', 'retomar quem não está pausado');
select lives_ok($$select resume_driver('00000000-0000-0000-0000-000000004a10', '2026-11-01')$$, 'retoma em 01/11');
select results_eq($$select paused, cycle_start_date from profiles where id = '00000000-0000-0000-0000-000000004a10'$$,
  $$values (false, '2026-11-01'::date)$$, 'perfil retomado com novo ciclo');
select is((select resumed_on from driver_pauses where driver_id = '00000000-0000-0000-0000-000000004a10'), '2026-11-01'::date,
  'resumed_on preenchido');
reset role;
create temp table pp2 as select driver_period_for('00000000-0000-0000-0000-000000004a10', '2026-11-01') as id;
create temp table pp3 as select driver_period_for('00000000-0000-0000-0000-000000004a10', '2026-11-16') as id;
select results_eq($$select start_date, end_date from driver_periods where id = (select id from pp2)$$,
  $$values ('2026-11-01'::date, '2026-11-15'::date)$$, 'nova quinzena 01/11–15/11');
select results_eq($$select start_date, end_date from driver_periods where id = (select id from pp3)$$,
  $$values ('2026-11-16'::date, '2026-11-30'::date)$$, 'seguinte 16/11–30/11');
select throws_ok($$select driver_period_for('00000000-0000-0000-0000-000000004a10', '2026-10-20')$$,
  'P0001', 'BEFORE_CYCLE_START', 'data dentro da pausa não tem quinzena');
select is(driver_period_for('00000000-0000-0000-0000-000000004a10', '2026-10-14'), (select id from pp1),
  'data antes da pausa segue na quinzena encurtada');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000004a10","role":"authenticated"}';
select lives_ok($$select start_transfer('00000000-0000-0000-0000-000000004b01', 5100, 'a.jpg')$$, 'retomado: inicia Transfer');
select throws_ok($$insert into fuelings (driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path)
  values (auth.uid(),'00000000-0000-0000-0000-000000004c02','2026-10-25','gasolina',60,10,6.000,'x')$$,
  'P0001', 'BEFORE_CYCLE_START', 'lançamento no intervalo da pausa recusado');

-- ===== cycle_start_date travado; quinzenas não se sobrepõem =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select throws_ok($$update profiles set cycle_start_date = '2026-11-05' where id = '00000000-0000-0000-0000-000000004a10'$$,
  'P0001', 'CYCLE_START_LOCKED', 'admin não muda o ciclo direto');
select lives_ok($$update profiles set name = 'P2' where id = '00000000-0000-0000-0000-000000004a10'$$, 'outras colunas seguem editáveis');
reset role;
set local request.jwt.claims = '{}';
select throws_ok($$update profiles set cycle_start_date = '2026-11-05' where id = '00000000-0000-0000-0000-000000004a10'$$,
  'P0001', 'CYCLE_START_LOCKED', 'nem a manutenção muda o ciclo direto');
select set_config('passos.resume_driver', 'on', true);
select throws_ok($$update profiles set cycle_start_date = '2026-11-05' where id = '00000000-0000-0000-0000-000000004a11'$$,
  'P0001', 'CYCLE_START_LOCKED', 'a flag sozinha não destrava (só junto da retomada)');
select set_config('passos.resume_driver', '', true);
select throws_ok($$insert into driver_periods (driver_id, start_date, end_date)
  values ('00000000-0000-0000-0000-000000004a10', '2026-11-10', '2026-11-20')$$,
  '23P01', null, 'quinzenas sobrepostas do mesmo motorista são recusadas');
select lives_ok($$insert into driver_periods (driver_id, start_date, end_date)
  values ('00000000-0000-0000-0000-000000004a10', '2030-01-10', '2030-01-20')$$, 'quinzena sem sobreposição é aceita');

-- ===== Sinais (hoje = data de SP) =====
-- S3/S6: quinzena hoje−15 … hoje−1 aberta → vermelho; S4/S6 pausados hoje
create temp table ps3 as select driver_period_for('00000000-0000-0000-0000-000000004a23', (select d from td) - 15) as id;
create temp table ps6 as select driver_period_for('00000000-0000-0000-0000-000000004a26', (select d from td) - 15) as id;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
select lives_ok($$select pause_driver('00000000-0000-0000-0000-000000004a24', (select d from td), null)$$, 'S4 pausado hoje');
select lives_ok($$select pause_driver('00000000-0000-0000-0000-000000004a26', (select d from td), null)$$, 'S6 pausado hoje');
select lives_ok($$select pause_driver('00000000-0000-0000-0000-000000004a27', (select d from td) - 1, null)$$, 'S7 pausado ontem');
reset role;
select throws_ok($$update profiles set paused = false where id = '00000000-0000-0000-0000-000000004a27'$$,
  'P0001', 'PAUSED_LOCKED', 'nem a manutenção muda paused direto');
-- estado inconsistente simulado (fixture): S7 despausado sem retomada → hoje cai na vaga encurtada (NO_PERIOD)
select set_config('passos.pause_driver', 'on', true);
update profiles set paused = false where id = '00000000-0000-0000-0000-000000004a27';
select set_config('passos.pause_driver', '', true);
-- inativos: S8 com quinzena terminada aberta, S9 com extrato não pago, S10 com tudo fechado e pago
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000004a28'), ('00000000-0000-0000-0000-000000004a29'), ('00000000-0000-0000-0000-000000004a30');
insert into profiles (id, role, login_code, seq_number, name, driver_type, uber_pct, transfer_pct, current_car_id, active, cpf, cycle_start_date) values
  ('00000000-0000-0000-0000-000000004a28','driver','dcl-28',9428,'S8','own_car',null,30,null,false,'62000000185',(select d from td) - 30),
  ('00000000-0000-0000-0000-000000004a29','driver','dcl-29',9429,'S9','own_car',null,30,null,false,'62000000266',(select d from td) - 30),
  ('00000000-0000-0000-0000-000000004a30','driver','dcl-30',9430,'S10','own_car',null,30,null,false,'62000000347',(select d from td) - 30);
insert into driver_periods (id, driver_id, start_date, end_date, status) values
  ('00000000-0000-0000-0000-000000004f28','00000000-0000-0000-0000-000000004a28',(select d from td) - 30,(select d from td) - 16,'open'),
  ('00000000-0000-0000-0000-000000004f29','00000000-0000-0000-0000-000000004a29',(select d from td) - 30,(select d from td) - 16,'closed'),
  ('00000000-0000-0000-0000-000000004f30','00000000-0000-0000-0000-000000004a30',(select d from td) - 30,(select d from td) - 16,'closed');
insert into statements (driver_id, driver_period_id, lines, total, paid_at, payment_method) values
  ('00000000-0000-0000-0000-000000004a29','00000000-0000-0000-0000-000000004f29','{}',10,null,null),
  ('00000000-0000-0000-0000-000000004a30','00000000-0000-0000-0000-000000004f30','{}',10,(select d from td) - 10,'pix');
set local role authenticated;
create temp table sig as select * from driver_period_signals();
reset role;
select results_eq($$select end_date - (select d from td), days_left, signal from sig where driver_id = '00000000-0000-0000-0000-000000004a21'$$,
  $$values (5, 5, 'yellow'::text)$$, 'fim em hoje+5 → amarelo');
select results_eq($$select days_left, signal from sig where driver_id = '00000000-0000-0000-0000-000000004a22'$$,
  $$values (6, null::text)$$, 'fim em hoje+6 → sem sinal');
select is((select signal from sig where driver_id = '00000000-0000-0000-0000-000000004a23'), 'red', 'quinzena terminada ontem e aberta → vermelho');
select is((select start_date from sig where driver_id = '00000000-0000-0000-0000-000000004a23'), (select d from td),
  'quinzena atual do S3 começa hoje');
select results_eq($$select paused, days_left, signal from sig where driver_id = '00000000-0000-0000-0000-000000004a24'$$,
  $$values (true, 0, null::text)$$, 'pausado com quinzena atual → sem sinal');
select is((select signal from sig where driver_id = '00000000-0000-0000-0000-000000004a26'), 'red', 'pausado com quinzena terminada aberta → vermelho');
select is((select count(*)::int from sig where driver_id = '00000000-0000-0000-0000-000000004a25'), 0, 'inativo sem pendência não aparece');
select results_eq($$select active, signal, current_period_id from sig where driver_id = '00000000-0000-0000-0000-000000004a28'$$,
  $$values (false, 'red'::text, null::uuid)$$, 'inativo com quinzena terminada aberta aparece em vermelho');
select results_eq($$select active, signal from sig where driver_id = '00000000-0000-0000-0000-000000004a29'$$,
  $$values (false, null::text)$$, 'inativo com extrato não pago aparece');
select is((select count(*)::int from sig where driver_id = '00000000-0000-0000-0000-000000004a30'), 0, 'inativo com tudo pago não aparece');
select is((select count(*)::int from driver_periods where driver_id = '00000000-0000-0000-0000-000000004a28'), 1, 'inativo: nenhuma quinzena nova criada');
select is((select bool_and(active) from sig where driver_id not in ('00000000-0000-0000-0000-000000004a28','00000000-0000-0000-0000-000000004a29')), true, 'demais saem como ativos');
select is((select current_period_id from sig where driver_id = '00000000-0000-0000-0000-000000004a21'),
  (select id from driver_periods where driver_id = '00000000-0000-0000-0000-000000004a21' and (select d from td) between start_date and end_date),
  'current_period_id é a quinzena de hoje');
select is((select name from sig where driver_id = '00000000-0000-0000-0000-000000004a21'), 'S1', 'nome do motorista');
select results_eq($$select current_period_id, signal from sig where driver_id = '00000000-0000-0000-0000-000000004a27'$$,
  $$values (null::uuid, null::text)$$, 'motorista inconsistente sai sem quinzena e sem sinal (não derruba a lista)');
select ok((select count(*) from sig where signal is not null) >= 3, 'demais motoristas seguem com sinais');

select * from finish();
rollback;
