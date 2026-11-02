begin;
select plan(71);
-- Endereço padrão dos Transfers destas fixtures (check de origem/destino da 0012; revertido no rollback).
-- O check em si é testado em transfer_flow.test.sql.
alter table rides
  alter column origin_street set default 'Rua A, 1', alter column origin_district set default 'Centro',
  alter column origin_city set default 'Passos', alter column origin_state set default 'MG',
  alter column dest_street set default 'Av. B, 2', alter column dest_district set default 'Centro',
  alter column dest_city set default 'Franca', alter column dest_state set default 'SP';

-- Personas do seed: admin ad01, João d001 (company_car, carro c001 da empresa), Maria d002 (own_car, carro c002 próprio)
-- Fixtures de transfer/abastecimento (como postgres)
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-0000000005a1','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 1','assigned'),
  ('00000000-0000-0000-0000-0000000005a2','00000000-0000-0000-0000-00000000d002','transfer','2026-03-05',200,'Cli 2','assigned'),
  ('00000000-0000-0000-0000-0000000005a3','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 3','checked'),
  ('00000000-0000-0000-0000-0000000005a4','00000000-0000-0000-0000-00000000d001','transfer','2026-03-05',200,'Cli 4','assigned');
insert into fuelings (id, driver_id, car_id, fueled_on, fuel, amount, quantity, unit_price, photo_path) values
  ('00000000-0000-0000-0000-0000000005f1','00000000-0000-0000-0000-00000000d001','00000000-0000-0000-0000-00000000c001','2026-03-05','gasolina',100,20,5.000,'x');
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
select hasnt_column('public', 'shifts', 'consumption_km_l', 'turno não guarda mais consumo');
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
-- (claims do João ainda ativas: conta como lançamento do motorista → comprovante)
insert into rides (driver_id, platform, ride_date, amount, km, receipt_path) values
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,50,'r.jpg'),
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,30,'r.jpg'),
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,70,'r.jpg'),
  ('00000000-0000-0000-0000-00000000d001','uber','2026-03-05',20,30,'r.jpg');
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
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a1', 10, 'b.jpg')$$,
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

-- km de corridas acima do odômetro: km_off nunca negativo
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b4','00000000-0000-0000-0000-00000000c001',1300,'p.jpg')$$,
  'turno para km_off negativo');
reset role;
insert into rides (driver_id, platform, ride_date, amount, km, receipt_path) values
  ('00000000-0000-0000-0000-00000000d001','blablacar','2026-03-05',20,120,'r.jpg');
set local role authenticated;
select is(
  end_shift('00000000-0000-0000-0000-0000000005b4',1400,'f.jpg',null),
  '{"km_total":100,"km_service":120,"km_off":0,"off_discount_estimate":null}'::jsonb,
  'km_off não fica negativo');

-- ===== João: iniciar/concluir transfer =====
-- carro da empresa: iniciar exige turno aberto
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000005a1', 1400, 'a.jpg')$$,
  'P0001', 'NO_OPEN_SHIFT', 'carro da empresa sem turno aberto');
select lives_ok(
  $$select start_shift('00000000-0000-0000-0000-0000000005b5','00000000-0000-0000-0000-00000000c001',1400,'p.jpg')$$,
  'turno aberto para os transfers');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a2', 1500, 'b.jpg')$$,
  'P0001', 'NOT_FOUND', 'transfer de outro motorista');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000005a1', -1, 'a.jpg')$$,
  'P0001', 'INVALID_ODOMETER', 'leitura negativa');
select throws_ok(
  $$select start_transfer('00000000-0000-0000-0000-0000000005a1', null, 'a.jpg')$$,
  'P0001', 'INVALID_ODOMETER', 'leitura nula');
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a3', 1500, 'b.jpg')$$,
  'P0001', 'ALREADY_CHECKED', 'transfer já conferido');
select throws_ok(
  $$select complete_transfer((select id from rides where platform = 'uber' limit 1), 1500, 'b.jpg')$$,
  'P0001', 'NOT_FOUND', 'corrida Uber não é transfer');
select is(
  (select transfer_status from start_transfer('00000000-0000-0000-0000-0000000005a1', 1400, 'a.jpg')),
  'in_progress', 'transfer iniciado');
select is(
  (select transfer_status from complete_transfer('00000000-0000-0000-0000-0000000005a1', 1442, 'b.jpg')),
  'completed', 'transfer concluído');
select is((select km from rides where id = '00000000-0000-0000-0000-0000000005a1'), 42.0, 'km = final − inicial');
select is(
  (select km from complete_transfer('00000000-0000-0000-0000-0000000005a1', 1442, 'b.jpg')),
  42.0, 'concluir repetido com a mesma leitura é idempotente');
select is((select shift_id from rides where id = '00000000-0000-0000-0000-0000000005a1'),
  '00000000-0000-0000-0000-0000000005b5'::uuid, 'transfer ligado ao turno aberto');
reset role;

-- ===== Admin: conferência =====
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select throws_ok(
  $$select complete_transfer('00000000-0000-0000-0000-0000000005a4', 10, 'b.jpg')$$,
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
select throws_ok($$select review_item('expense','00000000-0000-0000-0000-0000000005e1', false, 'ilegível')$$,
  'P0001', 'USE_TRANSFER_REVIEW', 'despesa só pela conferência do Transfer');
select is((select review_status from ride_expenses), 'pending', 'despesa segue pendente');
select lives_ok($$select review_item('shift','00000000-0000-0000-0000-0000000005b1', false, 'km errado')$$, 'admin recusa turno (protect_review_fields passa)');
select is((select reject_reason from shifts where id = '00000000-0000-0000-0000-0000000005b1'), 'km errado', 'turno recusado com motivo');

-- transfer: recusa devolve ao motorista (em andamento), aprovação confere com as despesas
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000005a1', false, 'km errado')$$, 'admin recusa transfer');
select is((select transfer_status || '/' || reject_reason from rides where id = '00000000-0000-0000-0000-0000000005a1'),
  'in_progress/km errado', 'transfer volta para in_progress com motivo');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
set local role authenticated;
select is((select reject_reason from complete_transfer('00000000-0000-0000-0000-0000000005a1', 1445, 'c.jpg')), null, 'concluir de novo limpa o motivo');
reset role;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}';
set local role authenticated;
select lives_ok($$select review_item('transfer','00000000-0000-0000-0000-0000000005a1', true, null)$$, 'admin aprova transfer');
select is((select transfer_status from rides where id = '00000000-0000-0000-0000-0000000005a1'), 'checked', 'transfer conferido');
select is((select review_status from ride_expenses where id = '00000000-0000-0000-0000-0000000005e1'), 'approved', 'despesa aprovada junto com o transfer');
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
