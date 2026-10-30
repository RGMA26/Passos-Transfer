begin;
select plan(64);

-- Fixtures (como postgres, ignora RLS)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e0'),
  ('00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000b2');

insert into profiles (id, role, login_code, seq_number, name, driver_type, transfer_pct, uber_pct) values
  ('00000000-0000-0000-0000-0000000000e0','admin','rls-admin',9001,'Adm',null,null,null),
  ('00000000-0000-0000-0000-0000000000b1','driver','rls-a',9002,'A','company_car',30,40),
  ('00000000-0000-0000-0000-0000000000b2','driver','rls-b',9003,'B','company_car',30,40);

insert into cars (id, model, plate, consumption_km_l, ownership, current_driver_id) values
  ('00000000-0000-0000-0000-0000000000d1','Onix','RLS0A01',10,'company','00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d2','HB20','RLS0B02',12,'company','00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000d3','Gol','RLS0C03',11,'company',null);

update profiles set current_car_id = '00000000-0000-0000-0000-0000000000d1' where id = '00000000-0000-0000-0000-0000000000b1';
update profiles set current_car_id = '00000000-0000-0000-0000-0000000000d2' where id = '00000000-0000-0000-0000-0000000000b2';

insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1',10,'2026-02-05',100),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000d2',12,'2026-02-05',100);

insert into rides (id, driver_id, platform, ride_date, amount) values
  ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-0000000000b1','uber','2026-02-05',50),
  ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-0000000000b2','uber','2026-02-05',60);
insert into rides (id, driver_id, platform, ride_date, amount, client_name, transfer_status) values
  ('00000000-0000-0000-0000-000000000a11','00000000-0000-0000-0000-0000000000b1','transfer','2026-02-05',200,'Cli A','assigned'),
  ('00000000-0000-0000-0000-000000000a12','00000000-0000-0000-0000-0000000000b2','transfer','2026-02-05',200,'Cli B','assigned'),
  ('00000000-0000-0000-0000-000000000a13','00000000-0000-0000-0000-0000000000b1','transfer','2026-02-05',200,'Cli A2','checked');

insert into ride_expenses (id, ride_id, kind, amount, photo_path) values
  ('00000000-0000-0000-0000-000000000e01','00000000-0000-0000-0000-000000000a11','toll',10,'x'),
  ('00000000-0000-0000-0000-000000000e02','00000000-0000-0000-0000-000000000a12','toll',10,'x');

insert into fuelings (id, driver_id, car_id, fueled_on, amount, liters, photo_path, review_status) values
  ('00000000-0000-0000-0000-000000000f01','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','2026-02-05',100,20,'x','pending'),
  ('00000000-0000-0000-0000-000000000f02','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','2026-02-05',100,20,'x','approved'),
  ('00000000-0000-0000-0000-000000000f03','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000d2','2026-02-05',100,20,'x','pending');

select period_for_date('2026-02-05');
select period_for_date('2026-01-05');

insert into adjustments (driver_id, period_id, kind, amount, description)
select d, period_for_date('2026-02-05'), 'bonus', 5, 'x'
from unnest(array['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2']::uuid[]) d;

insert into statements (driver_id, period_id)
select d, period_for_date('2026-02-05')
from unnest(array['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b2']::uuid[]) d;

-- Fixtures na quinzena que será fechada
insert into shifts (id, driver_id, car_id, consumption_km_l, start_date, odometer_start) values
  ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1',10,'2026-01-05',100);
insert into rides (id, driver_id, platform, ride_date, amount, shift_id) values
  ('00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-0000000000b1','uber','2026-01-05',50,'00000000-0000-0000-0000-0000000000f3');
insert into fuelings (id, driver_id, car_id, fueled_on, amount, liters, photo_path) values
  ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','2026-01-05',100,20,'x');
insert into ride_expenses (id, ride_id, kind, amount, photo_path) values
  ('00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000a21','toll',10,'x');

insert into storage.objects (bucket_id, name) values
  ('photos','00000000-0000-0000-0000-0000000000b1/a.jpg'),
  ('photos','00000000-0000-0000-0000-0000000000b2/b.jpg');

-- Bucket e privilégios
select is((select public from storage.buckets where id = 'photos'), false, 'bucket photos privado');
select ok(not has_function_privilege('anon', 'period_for_date(date)', 'execute'), 'anon não executa period_for_date');
select ok(has_function_privilege('authenticated', 'period_for_date(date)', 'execute'), 'authenticated executa period_for_date');

-- ===== Motorista A =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(is_admin(), false, 'motorista não é admin');
select is((select count(*)::int from rides where driver_id <> auth.uid()), 0, 'A não vê rides de B');
select is((select count(*)::int from rides where driver_id = auth.uid()), 4, 'A vê as próprias rides (inclui transfers)');
select is((select count(*)::int from fuelings where driver_id <> auth.uid()), 0, 'A não vê fuelings de B');
select is((select count(*)::int from shifts where driver_id <> auth.uid()), 0, 'A não vê shifts de B');
select is((select count(*)::int from statements where driver_id <> auth.uid()), 0, 'A não vê statements de B');
select is((select count(*)::int from statements), 1, 'A vê o próprio statement');
select is((select count(*)::int from adjustments where driver_id <> auth.uid()), 0, 'A não vê ajustes de B');
select is((select count(*)::int from ride_expenses where id = '00000000-0000-0000-0000-000000000e02'), 0, 'A não vê despesa de B');
select is((select count(*)::int from ride_expenses where id = '00000000-0000-0000-0000-000000000e01'), 1, 'A vê despesa do próprio transfer');
select is((select count(*)::int from profiles), 1, 'A vê só o próprio profile');
select is((select array_agg(id) from cars), array['00000000-0000-0000-0000-0000000000d1']::uuid[], 'A vê só o carro atual');
select is((select count(*)::int from audit_log), 0, 'A não lê audit_log');
select ok((select count(*) from periods) > 0, 'A lê periods');

-- escrita em rides
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, client_name, transfer_status)
    values ('00000000-0000-0000-0000-0000000000b1','transfer','2026-02-06',10,'X','assigned')$$,
  '42501', null, 'A não insere transfer');
select is_empty(
  $$update rides set transfer_status = 'completed' where id = '00000000-0000-0000-0000-000000000a11' returning id$$,
  'A não altera transfer_status');
select throws_ok(
  $$update rides set platform = 'transfer', client_name = 'x', transfer_status = 'assigned'
    where id = '00000000-0000-0000-0000-000000000a01'$$,
  '42501', null, 'A não converte uber em transfer');
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000b2','uber','2026-02-06',10)$$,
  '42501', null, 'A não insere ride para B');
select lives_ok(
  $$insert into rides (driver_id, platform, ride_date, amount)
    values ('00000000-0000-0000-0000-0000000000b1','uber','2026-02-06',10)$$,
  'A insere uber próprio');
select throws_ok(
  $$update rides set driver_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-000000000a01'$$,
  '42501', null, 'A não passa ride para B');
select is_empty(
  $$delete from rides where id = '00000000-0000-0000-0000-000000000a11' returning id$$,
  'A não apaga transfer');
select is_empty(
  $$update rides set amount = 1 where id = '00000000-0000-0000-0000-000000000a02' returning id$$,
  'A não edita ride de B');

-- fuelings
select is_empty(
  $$update fuelings set amount = 1 where id = '00000000-0000-0000-0000-000000000f02' returning id$$,
  'A não edita abastecimento aprovado');
select is_empty(
  $$delete from fuelings where id = '00000000-0000-0000-0000-000000000f02' returning id$$,
  'A não apaga abastecimento aprovado');
select isnt_empty(
  $$update fuelings set amount = 111 where id = '00000000-0000-0000-0000-000000000f01' returning id$$,
  'A edita abastecimento pendente');
select throws_ok(
  $$update fuelings set review_status = 'approved' where id = '00000000-0000-0000-0000-000000000f01'$$,
  'P0001', 'FORBIDDEN_FIELD', 'A não aprova o próprio abastecimento');
select throws_ok(
  $$update ride_expenses set review_status = 'approved' where id = '00000000-0000-0000-0000-000000000e01'$$,
  'P0001', 'FORBIDDEN_FIELD', 'A não aprova a própria despesa');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, amount, liters, photo_path, review_status)
    values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','2026-02-06',10,2,'x','approved')$$,
  '42501', null, 'A não insere abastecimento já aprovado');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, amount, liters, photo_path)
    values ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000d2','2026-02-06',10,2,'x')$$,
  '42501', null, 'A não insere abastecimento para B');
select lives_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, amount, liters, photo_path)
    values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','2026-02-06',10,2,'x')$$,
  'A insere abastecimento próprio');
select throws_ok(
  $$update fuelings set driver_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-000000000f01'$$,
  '42501', null, 'A não passa abastecimento para B');

-- ride_expenses
select lives_ok(
  $$insert into ride_expenses (ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-000000000a11','parking',5,'x')$$,
  'A insere despesa no próprio transfer atribuído');
select throws_ok(
  $$insert into ride_expenses (ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-000000000a12','parking',5,'x')$$,
  '42501', null, 'A não insere despesa em transfer de B');
select throws_ok(
  $$insert into ride_expenses (ride_id, kind, amount, photo_path)
    values ('00000000-0000-0000-0000-000000000a13','parking',5,'x')$$,
  '42501', null, 'A não insere despesa em transfer já checked');

-- profiles, shifts, adjustments, statements
select is_empty(
  $$update profiles set uber_pct = 90 where id = auth.uid() returning id$$,
  'A não altera o próprio uber_pct');
select is_empty(
  $$update profiles set role = 'admin' where id = auth.uid() returning id$$,
  'A não vira admin');
select throws_ok(
  $$insert into shifts (driver_id, car_id, consumption_km_l, start_date, odometer_start)
    values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1',10,'2026-02-06',1)$$,
  '42501', null, 'A não insere turno direto');
select is_empty(
  $$update shifts set odometer_start = 5 where id = '00000000-0000-0000-0000-0000000000f1' returning id$$,
  'A não edita turno direto');
select throws_ok(
  $$insert into adjustments (driver_id, period_id, kind, amount, description)
    values ('00000000-0000-0000-0000-0000000000b1', period_for_date('2026-02-06'), 'bonus', 99, 'x')$$,
  '42501', null, 'A não cria ajuste');
select throws_ok(
  $$insert into statements (driver_id, period_id) values ('00000000-0000-0000-0000-0000000000b1', period_for_date('2026-03-06'))$$,
  '42501', null, 'A não cria statement');

-- storage
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('photos', '00000000-0000-0000-0000-0000000000b1/c.jpg')$$,
  'A envia foto na própria pasta');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('photos', '00000000-0000-0000-0000-0000000000b2/c.jpg')$$,
  '42501', null, 'A não envia foto na pasta de B');
select is((select count(*)::int from storage.objects where bucket_id = 'photos' and name like '00000000-0000-0000-0000-0000000000b2/%'), 0, 'A não lê fotos de B');

reset role;

-- ===== Admin =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e0","role":"authenticated"}';

select is(is_admin(), true, 'admin é admin');
select is((select count(*)::int from rides where platform = 'transfer'), 3, 'admin vê todos os transfers');
select ok((select count(*) from audit_log) > 0, 'admin lê audit_log');
select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 3, 'admin lê todas as fotos');
select isnt_empty(
  $$update fuelings set review_status = 'approved' where id = '00000000-0000-0000-0000-000000000f03' returning id$$,
  'admin aprova abastecimento');
select lives_ok(
  $$update rides set transfer_status = 'completed' where id = '00000000-0000-0000-0000-000000000a12'$$,
  'admin altera transfer');

reset role;

-- ===== Quinzena fechada =====
update periods set status = 'closed', closed_at = now() where start_date = '2026-01-01';

select throws_ok(
  $$update fuelings set amount = 1 where id = '00000000-0000-0000-0000-000000000f11'$$,
  'P0001', 'PERIOD_CLOSED', 'postgres: update em quinzena fechada bloqueado');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e0","role":"authenticated"}';
select throws_ok(
  $$update fuelings set amount = 1 where id = '00000000-0000-0000-0000-000000000f11'$$,
  'P0001', 'PERIOD_CLOSED', 'admin: update de abastecimento em quinzena fechada');
select throws_ok(
  $$update fuelings set fueled_on = '2026-02-06' where id = '00000000-0000-0000-0000-000000000f11'$$,
  'P0001', 'PERIOD_CLOSED', 'admin: não move abastecimento para fora da quinzena fechada');
select throws_ok(
  $$update fuelings set fueled_on = '2026-01-06' where id = '00000000-0000-0000-0000-000000000f01'$$,
  'P0001', 'PERIOD_CLOSED', 'admin: não move abastecimento para dentro da quinzena fechada');
select throws_ok(
  $$delete from rides where id = '00000000-0000-0000-0000-000000000a21'$$,
  'P0001', 'PERIOD_CLOSED', 'admin: delete de ride em quinzena fechada');
select throws_ok(
  $$update ride_expenses set amount = 1 where id = '00000000-0000-0000-0000-000000000e11'$$,
  'P0001', 'PERIOD_CLOSED', 'admin: despesa de ride em quinzena fechada');
select throws_ok(
  $$update shifts set odometer_start = 1 where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'P0001', 'PERIOD_CLOSED', 'admin: turno em quinzena fechada');
select throws_ok(
  $$insert into adjustments (driver_id, period_id, kind, amount, description)
    values ('00000000-0000-0000-0000-0000000000b1', period_for_date('2026-01-06'), 'bonus', 1, 'x')$$,
  'P0001', 'PERIOD_CLOSED', 'admin: ajuste em quinzena fechada');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$insert into rides (driver_id, platform, ride_date, amount, shift_id)
    values ('00000000-0000-0000-0000-0000000000b1','uber','2026-01-07',10,'00000000-0000-0000-0000-0000000000f1')$$,
  'P0001', 'PERIOD_CLOSED', 'A: insert de uber em quinzena fechada');
select throws_ok(
  $$delete from fuelings where id = '00000000-0000-0000-0000-000000000f11'$$,
  'P0001', 'PERIOD_CLOSED', 'A: delete de abastecimento em quinzena fechada');
reset role;

-- ===== Motorista inativo =====
update profiles set active = false where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from rides), 0, 'motorista inativo não vê rides');
select throws_ok(
  $$insert into fuelings (driver_id, car_id, fueled_on, amount, liters, photo_path)
    values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','2026-02-07',10,2,'x')$$,
  '42501', null, 'motorista inativo não insere');
reset role;

select * from finish();
rollback;
