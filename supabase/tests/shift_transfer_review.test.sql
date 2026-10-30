begin;
select plan(64);

-- Personas do seed: admin ad01, João d001 (company_car, carro c001 da empresa), Maria d002 (own_car, carro c002 próprio)
-- Fixtures de transfer/abastecimento (como postgres)
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 1','assigned'),
  ('00000000-0000-0000-0000-0000000005a2','00000000-0000-0000-0000-00000000d002','transfer','2026-03-05',200,'Cli 2','assigned'),
  ('00000000-0000-0000-0000-0000000005a3','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 3','checked'),
  ('00000000-0000-0000-0000-0000000005a4','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 4','assigned');
insert into fuelings (id, driver_id, car_id, fueled_on, amount, liters, photo_path) values
  ('00000000-0000-0000-0000-0000000005f1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-03-05',100,20,'x');
insert into ride_expenses (id, ride_id, kind, amount, photo_path) values
  ('00000000-0000-0000-0000-0000000005e1','00000000-0000-0000-0000-0000000005a1','toll',10,'x');

-- Privilégios
select ok(not has_function_privilege('anon', 'start_shift(uuid,uuid,int,text)', 'execute'), 'anon não executa start_shift');
select ok(not has_function_privilege('anon', 'review_item(text,uuid,boolean,text)', 'execute'), 'anon não executa review_item');
select ok(has_function_privilege('authenticated', 'end_shift(uuid,int,text,text)', 'execute'), 'authenticated executa end_shift');

-- ===== João: iniciar turno =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';

select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-00000000c001',1000,'')$$,
  'P0001', 'PHOTO_REQUIRED', 'start_shift sem foto');
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-00000000c002',1000,'p.jpg')$$,
  'P0001', 'NOT_COMPANY_CAR', 'start_shift com carro próprio');
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-00000000c001',1000,'p.jpg')$$,
  'start_shift ok');
select is((select count(*)::int from shifts), 1, 'um turno criado');
select is((select consumption_km_l from shifts), 10.00, 'snapshot do consumo');
select is((select start_date from shifts), (now() at time zone 'America/Sao_Paulo')::date, 'start_date em America/Sao_Paulo');
select is((select odometer_start_photo from shifts), 'p.jpg', 'foto inicial gravada');
select is(
  (select (start_shift('00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-00000000c001',9999,'outra.jpg')).odometer_start),
  1000, 'mesmo id devolve o existente sem alterar');
select is((select count(*)::int from shifts), 1, 'mesmo id não duplica');
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b2','00000000-0000-0000-0000-00000000c001',1000,'p.jpg')$$,
  'P0001', 'SHIFT_ALREADY_OPEN', 'segundo turno com outro id');

-- corridas Uber no turno (km 50+30+70+30)
reset role;
insert into rides (driver_id, platform, ride_date, amount, km) values
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,50),
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,30),
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,70),
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,30);
select is((select count(*)::int from rides where shift_id = '00000000-0000-0000-0000-0000000005b1'), 4, 'corridas ligadas ao turno');

-- ===== Maria: não mexe no turno do João =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b1','00000000-0000-0000-0000-00000000c001',1,'p.jpg')$$,
  'P0001', 'FORBIDDEN', 'outro motorista não reusa id de turno');
select throws_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b3','00000000-0000-0000-0000-00000000c001',1,'p.jpg')$$,
  'P0001', 'NOT_COMPANY_CAR', 'motorista de carro próprio não inicia turno');
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000005b1',1200,'f.jpg','u.jpg')$$,
  'P0001', 'NOT_FOUND', 'outro motorista não encerra turno alheio');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a1', 10)$$,
  'P0001', 'NOT_FOUND', 'outro motorista não conclui transfer alheio');
select throws_ok(
  $$select review_item('transfer','00000000-0000-0000-0000-0000000005a1', true, null)$$,
  'P0001', 'FORBIDDEN', 'motorista não chama review_item');
select lives_ok($$select clear_must_change_password()$$, 'Maria limpa a própria flag');
reset role;

-- ===== João: encerrar turno =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000005b1',990,'f.jpg','u.jpg')$$,
  'P0001', 'ODOMETER_BELOW_START', 'odômetro final abaixo do inicial');
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000005b1',1200,'','u.jpg')$$,
  'P0001', 'PHOTO_REQUIRED', 'sem foto do odômetro');
select throws_ok(
  $$select end_shift('00000000-0000-0000-0000-0000000005b1',1200,'f.jpg',null)$$,
  'P0001', 'UBER_PHOTO_REQUIRED', 'Uber sem print');
select is((select ended_at from shifts), null, 'falhas não encerram o turno');
select is(
  end_shift('00000000-0000-0000-0000-0000000005b1',1200,'f.jpg','u.jpg'),
  '{"km_total":200,"km_service":180,"km_off":20,"off_discount_estimate":null}'::jsonb,
  'end_shift devolve os totais');
select is((select odometer_end from shifts), 1200, 'odômetro final gravado');
select is((select uber_earnings_photo from shifts), 'u.jpg', 'print do Uber gravado');
select isnt((select ended_at from shifts), null, 'turno encerrado');
select is(
  end_shift('00000000-0000-0000-0000-0000000005b1',1500,'z.jpg','z.jpg'),
  '{"km_total":200,"km_service":180,"km_off":20,"off_discount_estimate":null}'::jsonb,
  'end_shift repetido devolve o mesmo resultado');
select is((select odometer_end from shifts), 1200, 'repetição não altera o turno');

-- turno sem Uber: print não é exigido; km nulo conta 0
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b2','00000000-0000-0000-0000-00000000c001',1200,'p.jpg')$$,
  'novo turno após encerrar');
select is(
  end_shift('00000000-0000-0000-0000-0000000005b2',1300,'f.jpg',null),
  '{"km_total":100,"km_service":0,"km_off":100,"off_discount_estimate":null}'::jsonb,
  'turno sem corridas nem Uber');

-- ===== João: concluir transfer =====
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a2', 10)$$,
  'P0001', 'NOT_FOUND', 'transfer de outro motorista');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a1', -1)$$,
  'P0001', 'INVALID_KM', 'km negativo');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a1', null)$$,
  'P0001', 'INVALID_KM', 'km nulo');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a3', 10)$$,
  'P0001', 'ALREADY_CHECKED', 'transfer já conferido');
select throws_ok(
  $$select complete_transfer((select id from rides where platform = 'uber' limit 1), 10)$$,
  'P0001', 'NOT_FOUND', 'corrida Uber não é transfer');
select is(
  (select transfer_status from complete_transfer('00000000-0000-0000-0000-0000000005a1', 42.5)),
  'completed', 'transfer concluído');
select is((select km from rides where id = '00000000-0000-0000-0000-0000000005a1'), 42.5, 'km gravado');
select is(
  (select km from complete_transfer('00000000-0000-0000-0000-0000000005a1', 50)),
  50.0, 'completed pode ser reenviado');
reset role;

-- ===== Admin: conferência =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a4', 10)$$,
  'P0001', 'FORBIDDEN', 'admin não conclui transfer');
select throws_ok(
  $$select start_shift(gen_random_uuid(),'00000000-0000-0000-0000-00000000c001',1,'p.jpg')$$,
  'P0001', 'FORBIDDEN', 'admin não inicia turno');
select throws_ok(
  $$select review_item('banana','00000000-0000-0000-0000-0000000005a1', true, null)$$,
  'P0001', 'INVALID_KIND', 'tipo desconhecido');
select throws_ok(
  $$select review_item('fueling','00000000-0000-0000-0000-0000000005f1', false, null)$$,
  'P0001', 'REASON_REQUIRED', 'recusa sem motivo');
select throws_ok(
  $$select review_item('fueling','00000000-0000-0000-0000-0000000005f1', false, '   ')$$,
  'P0001', 'REASON_REQUIRED', 'recusa com motivo em branco');
select throws_ok(
  $$select review_item('fueling', gen_random_uuid(), true, null)$$,
  'P0001', 'NOT_FOUND', 'item inexistente');
select throws_ok(
  $$select review_item('transfer','00000000-0000-0000-0000-0000000005a4', true, null)$$,
  'P0001', 'NOT_REVIEWABLE', 'transfer não concluído');
select throws_ok(
  $$select review_item('transfer','00000000-0000-0000-0000-0000000005a3', true, null)$$,
  'P0001', 'NOT_REVIEWABLE', 'transfer já conferido');

-- abastecimento
select lives_ok($$select review_item('fueling','00000000-0000-0000-0000-0000000005f1', false, 'foto ruim')$$, 'admin recusa abastecimento');
select is((select review_status || '/' || reject_reason from fuelings), 'rejected/foto ruim', 'abastecimento recusado com motivo');
select lives_ok($$select review_item('fueling','00000000-0000-0000-0000-0000000005f1', true, 'ignorado')$$, 'admin aprova abastecimento');
select is((select review_status || '/' || coalesce(reject_reason, 'null') from fuelings), 'approved/null', 'aprovação limpa o motivo');

-- despesa e turno
select lives_ok($$select review_item('expense','00000000-0000-0000-0000-0000000005e1', false, 'ilegível')$$, 'admin recusa despesa');
select is((select review_status from ride_expenses), 'rejected', 'despesa recusada');
select lives_ok($$select review_item('shift','00000000-0000-0000-0000-0000000005b1', false, 'km errado')$$, 'admin recusa turno (protect_review_fields passa)');
select is((select reject_reason from shifts where id = '00000000-0000-0000-0000-0000000005b1'), 'km errado', 'turno recusado com motivo');

-- transfer: recusa devolve ao motorista, aprovação confere
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000005a1', false, 'km errado')$$, 'admin recusa transfer');
select is((select transfer_status || '/' || reject_reason from rides where id = '00000000-0000-0000-0000-0000000005a1'),
  'assigned/km errado', 'transfer volta para assigned com motivo');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select is((select reject_reason from complete_transfer('00000000-0000-0000-0000-0000000005a1', 45)), null, 'concluir de novo limpa o motivo');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000005a1', true, null)$$, 'admin aprova transfer');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000005a1'), 'checked', 'transfer conferido');
reset role;

-- ===== clear_must_change_password =====
update profiles set must_change_password = true where role = 'driver';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select clear_must_change_password()$$, 'João limpa a própria flag');
reset role;
select is((select must_change_password from profiles where id = '00000000-0000-0000-0000-00000000d001'), false, 'flag de João limpa');
select is((select must_change_password from profiles where id = '00000000-0000-0000-0000-00000000d002'), true, 'flag de Maria intacta');

select * from finish();
rollback;
