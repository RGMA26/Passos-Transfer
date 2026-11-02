begin;
select plan(91);

-- Personas do seed: admin ad01, João d001 (company_car, carro c001 da empresa),
-- Maria d002 (own_car, carro c002 próprio). Fixtures próprias: uuids 3xxx.

-- ===== Esquema e privilégios =====
select has_column('public', 'rides', 'odometer_start', 'rides.odometer_start');
select has_column('public', 'rides', 'odometer_end_photo', 'rides.odometer_end_photo');
select has_column('public', 'rides', 'started_at', 'rides.started_at');
select has_column('public', 'rides', 'car_id', 'rides.car_id');
select has_column('public', 'rides', 'receipt_path', 'rides.receipt_path');
select has_column('public', 'rides', 'origin_zip', 'rides.origin_zip');
select has_column('public', 'rides', 'dest_ref', 'rides.dest_ref');
select col_type_is('public', 'rides', 'estimated_km', 'numeric(8,1)', 'estimated_km numeric(8,1)');
select hasnt_function('public', 'complete_transfer', array['uuid','numeric'], 'complete_transfer(uuid, numeric) removida');
select ok(not has_function_privilege('anon', 'start_transfer(uuid,int,text)', 'execute'), 'anon não executa start_transfer');
select ok(not has_function_privilege('anon', 'complete_transfer(uuid,int,text)', 'execute'), 'anon não executa complete_transfer');
select ok(has_function_privilege('authenticated', 'start_transfer(uuid,int,text)', 'execute'), 'authenticated executa start_transfer');
select ok(has_function_privilege('authenticated', 'complete_transfer(uuid,int,text)', 'execute'), 'authenticated executa complete_transfer');
select ok(not has_function_privilege('authenticated', 'car_last_odometer(uuid)', 'execute'), 'car_last_odometer é interno');

-- ===== Origem e destino obrigatórios =====
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status)
    values ('00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Sem endereço','assigned')$$,
  '23514', null, 'transfer sem origem/destino rejeitado');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status,
      origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state)
    values ('00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli','assigned',
      'Rua A, 1','Centro','Passos','MG','Rua B, 2','Centro','  ','MG')$$,
  '23514', null, 'transfer com cidade de destino em branco rejeitado');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status,
      origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state)
    values ('00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli','banana',
      'Rua A, 1','Centro','Passos','MG','Rua B, 2','Centro','Franca','SP')$$,
  '23514', null, 'transfer_status inválido rejeitado');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status, estimated_km,
      origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state)
    values ('00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli','assigned',-1,
      'Rua A, 1','Centro','Passos','MG','Rua B, 2','Centro','Franca','SP')$$,
  '23514', null, 'km estimado negativo rejeitado');

-- Fixtures (como postgres, sem claims): T1/T2 João, T3/T4 Maria
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status, estimated_km,
    origin_street, origin_district, origin_city, origin_state, origin_zip,
    dest_street, dest_district, dest_city, dest_state) values
  ('00000000-0000-0000-0000-0000000031a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 1','assigned',40.5,
   'Rua A, 1','Centro','Passos','MG','37900-000','Av. B, 2','Centro','Franca','SP'),
  ('00000000-0000-0000-0000-0000000031a2','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 2','assigned',null,
   'Rua A, 1','Centro','Passos','MG',null,'Av. B, 2','Centro','Franca','SP'),
  ('00000000-0000-0000-0000-0000000031a3','00000000-0000-0000-0000-00000000d002','transfer','2026-03-05',200,'Cli 3','assigned',null,
   'Rua A, 1','Centro','Passos','MG',null,'Av. B, 2','Centro','Franca','SP'),
  ('00000000-0000-0000-0000-0000000031a4','00000000-0000-0000-0000-00000000d002','transfer','2026-03-05',200,'Cli 4','assigned',null,
   'Rua A, 1','Centro','Passos','MG',null,'Av. B, 2','Centro','Franca','SP');
select is((select estimated_km from rides where id = '00000000-0000-0000-0000-0000000031a1'), 40.5, 'km estimado gravado');

-- ===== João: iniciar exige turno aberto =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';

select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a1', 5000, 'a.jpg')$$,
  'P0001', 'NO_OPEN_SHIFT', 'carro da empresa sem turno aberto não inicia');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', 5042, 'b.jpg')$$,
  'P0001', 'NOT_STARTED', 'não conclui sem iniciar');
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000031b1','00000000-0000-0000-0000-00000000c001',4900,'s.jpg')$$,
  'João abre turno em 4900');

-- comprovante de corrida Uber/BlaBlaCar
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, km)
    values ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,10)$$,
  'P0001', 'RECEIPT_REQUIRED', 'Uber sem comprovante');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, km, receipt_path)
    values ('00000000-0000-0000-0000-00000000d001','blablacar','2026-03-05',20,10,'  ')$$,
  'P0001', 'RECEIPT_REQUIRED', 'BlaBlaCar com comprovante em branco');
select lives_ok(
  $$insert into rides (id, driver_id, platform, ride_date, amount, km, receipt_path)
    values ('00000000-0000-0000-0000-0000000031ab','00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,10,'d001/u.jpg')$$,
  'Uber com comprovante');
select throws_ok(
  $$update rides set receipt_path = '' where id = '00000000-0000-0000-0000-0000000031ab'$$,
  'P0001', 'RECEIPT_REQUIRED', 'motorista não apaga o comprovante');
select lives_ok(
  $$update rides set amount = 25 where id = '00000000-0000-0000-0000-0000000031ab'$$,
  'motorista edita corrida mantendo o comprovante');
-- colunas de Transfer numa corrida Uber são anuladas (não envenenam o último odômetro do carro)
select lives_ok(
  $$insert into rides (id, driver_id, platform, ride_date, amount, km, receipt_path,
      car_id, odometer_start, odometer_end, started_at, estimated_km, origin_street)
    values ('00000000-0000-0000-0000-0000000031ac','00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,0,'d001/u2.jpg',
      '00000000-0000-0000-0000-00000000c001',999999,999999,now(),5,'Rua X')$$,
  'Uber com colunas de Transfer');
select is(
  (select coalesce(car_id::text, 'null') || '/' || coalesce(odometer_start::text, 'null') || '/'
          || coalesce(odometer_end::text, 'null') || '/' || coalesce(estimated_km::text, 'null') || '/'
          || coalesce(origin_street, 'null') from rides where id = '00000000-0000-0000-0000-0000000031ac'),
  'null/null/null/null/null', 'Uber: colunas de Transfer anuladas no insert');
select lives_ok(
  $$update rides set car_id = '00000000-0000-0000-0000-00000000c001', odometer_end = 999999 where id = '00000000-0000-0000-0000-0000000031ac'$$,
  'motorista tenta gravar odômetro numa corrida Uber');
select is((select coalesce(odometer_end::text, 'null') from rides where id = '00000000-0000-0000-0000-0000000031ac'), 'null', 'Uber: anulado no update');
-- Transfer: o motorista não grava leituras fora das RPCs
select lives_ok(
  $$update rides set odometer_start = 999999, car_id = '00000000-0000-0000-0000-00000000c001' where id = '00000000-0000-0000-0000-0000000031a2'$$,
  'motorista tenta gravar odômetro do Transfer direto');
select is((select coalesce(odometer_start::text, 'null') from rides where id = '00000000-0000-0000-0000-0000000031a2'), 'null', 'Transfer: leitura direta não gravada');

-- iniciar
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a1', 5000, '')$$,
  'P0001', 'PHOTO_REQUIRED', 'iniciar sem foto');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a1', null, 'a.jpg')$$,
  'P0001', 'INVALID_ODOMETER', 'iniciar sem leitura');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a1', 4800, 'a.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'leitura abaixo do turno aberto do carro');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a3', 5000, 'a.jpg')$$,
  'P0001', 'NOT_FOUND', 'João não inicia transfer da Maria');
select is(
  (select transfer_status from start_transfer('00000000-0000-0000-0000-0000000031a1', 5000, 'a.jpg')),
  'in_progress', 'iniciar: assigned → in_progress');
select is(
  (select odometer_start || '/' || odometer_start_photo || '/' || car_id || '/' || shift_id
     from rides where id = '00000000-0000-0000-0000-0000000031a1'),
  '5000/a.jpg/00000000-0000-0000-0000-00000000c001/00000000-0000-0000-0000-0000000031b1',
  'leitura, foto, carro e turno gravados');
select isnt((select started_at from rides where id = '00000000-0000-0000-0000-0000000031a1'), null, 'started_at gravado');
select is(
  (select odometer_start from start_transfer('00000000-0000-0000-0000-0000000031a1', 5000, 'outra.jpg')),
  5000, 'iniciar repetido com a mesma leitura é idempotente');
select is((select odometer_start_photo from rides where id = '00000000-0000-0000-0000-0000000031a1'), 'a.jpg', 'repetição não altera');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a1', 5010, 'a.jpg')$$,
  'P0001', 'ALREADY_STARTED', 'iniciar de novo com outra leitura');

-- despesas: Transfer atribuído ou em andamento, sempre com comprovante
select lives_ok(
  $$insert into ride_expenses (id, ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-0000000031e1','00000000-0000-0000-0000-0000000031a1','toll',10,'d001/p.jpg')$$,
  'pedágio em Transfer em andamento');
select lives_ok(
  $$insert into ride_expenses (id, ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-0000000031e2','00000000-0000-0000-0000-0000000031a2','parking',15,'d001/e.jpg')$$,
  'estacionamento em Transfer atribuído');
select throws_ok(
  $$insert into ride_expenses (ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-0000000031a1','parking',5,'  ')$$,
  '23514', null, 'despesa sem comprovante rejeitada');

-- concluir
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', 4990, 'b.jpg')$$,
  'P0001', 'ODOMETER_BELOW_START', 'final menor que o inicial');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', null, 'b.jpg')$$,
  'P0001', 'ODOMETER_BELOW_START', 'final nulo');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', 5042, '')$$,
  'P0001', 'PHOTO_REQUIRED', 'concluir sem foto');
select is(
  (select transfer_status || '/' || km from complete_transfer('00000000-0000-0000-0000-0000000031a1', 5042, 'b.jpg')),
  'completed/42.0', 'concluir: completed com km = final − inicial');
select is(
  (select km from complete_transfer('00000000-0000-0000-0000-0000000031a1', 5042, 'b.jpg')),
  42.0, 'concluir repetido com a mesma leitura é idempotente');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', 5050, 'b.jpg')$$,
  'P0001', 'ALREADY_COMPLETED', 'concluído aguarda conferência');
reset role;

-- ===== Maria não inicia/conclui transfer do João =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a2', 6000, 'a.jpg')$$,
  'P0001', 'NOT_FOUND', 'outro motorista não inicia');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', 6000, 'a.jpg')$$,
  'P0001', 'NOT_FOUND', 'outro motorista não conclui');
reset role;

-- ===== Admin: conferência única =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a2', 6000, 'a.jpg')$$,
  'P0001', 'FORBIDDEN', 'admin não inicia transfer');
select throws_ok(
  $$select review_item('expense','00000000-0000-0000-0000-0000000031e1', true, null)$$,
  'P0001', 'USE_TRANSFER_REVIEW', 'despesa só pela conferência do Transfer');
select throws_ok(
  $$select review_item('transfer','00000000-0000-0000-0000-0000000031a2', true, null)$$,
  'P0001', 'NOT_REVIEWABLE', 'transfer atribuído não é conferível');
select lives_ok(
  $$select review_item('transfer','00000000-0000-0000-0000-0000000031a1', false, 'odômetro ilegível')$$,
  'admin recusa transfer');
select is(
  (select transfer_status || '/' || reject_reason from rides where id = '00000000-0000-0000-0000-0000000031a1'),
  'in_progress/odômetro ilegível', 'recusa: volta para in_progress com motivo');
select is((select review_status from ride_expenses where id = '00000000-0000-0000-0000-0000000031e1'), 'pending', 'recusa: despesa segue pendente');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select is(
  (select transfer_status || '/' || km || '/' || coalesce(reject_reason, 'null')
     from complete_transfer('00000000-0000-0000-0000-0000000031a1', 5050, 'c.jpg')),
  'completed/50.0/null', 'concluir de novo: nova leitura e motivo limpo');
select is((select odometer_end_photo from rides where id = '00000000-0000-0000-0000-0000000031a1'), 'c.jpg', 'nova foto final');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000031a1', true, null)$$, 'admin aprova transfer');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000031a1'), 'checked', 'aprovado: checked');
select is((select review_status || '/' || coalesce(reject_reason, 'null') from ride_expenses where id = '00000000-0000-0000-0000-0000000031e1'),
  'approved/null', 'aprovado: despesa aprovada junto');
select is((select review_status from ride_expenses where id = '00000000-0000-0000-0000-0000000031e2'), 'pending', 'despesa de outro transfer intacta');
-- admin lança corrida sem comprovante (correção)
select lives_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, km)
    values ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,10)$$,
  'admin lança Uber sem comprovante');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a1', 5100, 'd.jpg')$$,
  'P0001', 'ALREADY_CHECKED', 'conferido não é concluído de novo');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a1', 5100, 'd.jpg')$$,
  'P0001', 'INVALID_STATUS', 'conferido não é iniciado de novo');
select throws_ok(
  $$insert into ride_expenses (ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-0000000031a1','parking',5,'d001/x.jpg')$$,
  '42501', null, 'despesa em transfer conferido negada');

-- km do Transfer conta como serviço do turno (uber 10 + transfer 50)
select is(
  end_shift('00000000-0000-0000-0000-0000000031b1', 5100, 'f.jpg', 'u.jpg')->>'km_service',
  '70.0', 'turno: km do Transfer conferido conta como serviço (uber 10 + 10 do admin + transfer 50)');

-- último odômetro do carro inclui Transfers
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000031b2','00000000-0000-0000-0000-00000000c001',5100,'s.jpg')$$,
  'novo turno em 5100');
select lives_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a2', 5200, 'a.jpg')$$,
  'T2 iniciado em 5200');
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000031b2', 5250, 'f.jpg', null)$$,
  'P0001', 'TRANSFER_IN_PROGRESS', 'turno não encerra com Transfer em andamento');
select lives_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a2', 5300, 'b.jpg')$$,
  'T2 concluído em 5300');
select is(
  end_shift('00000000-0000-0000-0000-0000000031b2', 5250, 'f.jpg', null)->>'km_service',
  '100.0', 'turno: Transfer concluído conta como serviço');
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000031b3','00000000-0000-0000-0000-00000000c001',5280,'s.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'turno abaixo da leitura final de um Transfer do carro');
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000031b3','00000000-0000-0000-0000-00000000c001',5300,'s.jpg')$$,
  'turno na leitura do Transfer');
reset role;

-- ===== Maria (carro próprio): sem turno, carro atual =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
set local role authenticated;
select is(
  (select coalesce(shift_id::text, 'null') || '/' || car_id
     from start_transfer('00000000-0000-0000-0000-0000000031a3', 30000, 'a.jpg')),
  'null/00000000-0000-0000-0000-00000000c002', 'carro próprio: sem turno, carro atual');
select is(
  (select km from complete_transfer('00000000-0000-0000-0000-0000000031a3', 30100, 'b.jpg')),
  100.0, 'carro próprio: km pelo odômetro');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a4', 900, 'a.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'carro próprio: abaixo do último Transfer');
select lives_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a4', 30100, 'a.jpg')$$,
  'carro próprio: na última leitura');
reset role;

-- ===== Admin reatribui Transfer em andamento: volta para atribuído =====
update rides set driver_id = '00000000-0000-0000-0000-00000000d001'
  where id = '00000000-0000-0000-0000-0000000031a4';
select is(
  (select transfer_status || '/' || coalesce(odometer_start::text, 'null') || '/' || coalesce(car_id::text, 'null')
     from rides where id = '00000000-0000-0000-0000-0000000031a4'),
  'assigned/null/null', 'reatribuído em andamento: volta para assigned sem leituras');

-- ===== Extrato: Transfer concluído da Maria =====
create temp table pm as select driver_period_for('00000000-0000-0000-0000-00000000d002','2026-03-05') as id;
select is(
  (select compute_statement('00000000-0000-0000-0000-00000000d002', (select id from pm))->'transfer_share'),
  '60.00'::jsonb, 'extrato da Maria conta o Transfer concluído');

-- start 900 após turno em 1200 (carro da empresa Gol)
insert into cars (id, model, plate, fuel_type, km_per_l_gasolina, ownership) values
  ('00000000-0000-0000-0000-0000000031c1','Gol','TRF0A01','flex',10,'company');
update shifts set ended_at = now(), odometer_end = 5400 where id = '00000000-0000-0000-0000-0000000031b3';
insert into shifts (id, driver_id, car_id, start_date, odometer_start, odometer_end, ended_at)
  values ('00000000-0000-0000-0000-0000000031b9','00000000-0000-0000-0000-00000000d001',
          '00000000-0000-0000-0000-0000000031c1','2026-03-04',1000,1200,now());
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000031b4','00000000-0000-0000-0000-0000000031c1',1200,'s.jpg')$$,
  'João abre turno no Gol em 1200');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a4', 900, 'a.jpg')$$,
  'P0001', 'ODOMETER_BELOW_LAST', 'start 900 após turno 1200');
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000031a4', 1200, 'a.jpg')$$, 'T4 iniciado em 1200');
reset role;

-- ===== Quinzena fechada: não conclui =====
update driver_periods set status = 'closed', closed_at = now()
 where driver_id = '00000000-0000-0000-0000-00000000d001' and '2026-03-05' between start_date and end_date;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a4', 1250, 'b.jpg')$$,
  'P0001', 'PERIOD_CLOSED', 'quinzena fechada: não conclui');
reset role;

-- ===== Motorista pausado: não inicia nem conclui depois do fim da última quinzena =====
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status,
    origin_street, origin_district, origin_city, origin_state, dest_street, dest_district, dest_city, dest_state) values
  ('00000000-0000-0000-0000-0000000031a5','00000000-0000-0000-0000-00000000d002','transfer','2026-03-20',100,'Cli 5','assigned','Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP'),
  ('00000000-0000-0000-0000-0000000031a6','00000000-0000-0000-0000-00000000d002','transfer','2026-03-20',100,'Cli 6','assigned','Rua A, 1','Centro','Passos','MG','Av. B, 2','Centro','Franca','SP');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select start_transfer('00000000-0000-0000-0000-0000000031a6', 30100, 'a.jpg')$$, 'Maria inicia T6 antes da pausa');
reset role;
-- pausa no dia 18/03: quinzena 17/03–31/03 encurtada (como a pausa fará)
update driver_periods set end_date = '2026-03-18' where driver_id = '00000000-0000-0000-0000-00000000d002' and start_date = '2026-03-17';
update profiles set paused = true where id = '00000000-0000-0000-0000-00000000d002';
set local role authenticated;
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000031a5', 30100, 'a.jpg')$$,
  'P0001', 'DRIVER_PAUSED', 'pausado: não inicia');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000031a6', 30150, 'b.jpg')$$,
  'P0001', 'DRIVER_PAUSED', 'pausado: não conclui');
reset role;

select * from finish();
rollback;
